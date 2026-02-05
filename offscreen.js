/**
 * Offscreen Document - Audio Processor
 * =====================================
 * Chrome Extension MV3 아키텍처에서 Web Audio API 및 Silero-VAD 실행
 *
 * 핵심 기능:
 * 1. Tab Audio Capture (chrome.tabCapture)
 * 2. Silero-VAD (WASM) - 음성 감지
 * 3. Deepgram WebSocket STT - 실시간 음성→텍스트
 * 4. Partial Results 지원 - 최소 지연 시간
 */

// ============================================
// Configuration
// ============================================
const CONFIG = {
    // Audio
    SAMPLE_RATE: 16000,
    VAD_FRAME_SIZE: 512,        // ~32ms at 16kHz
    BUFFER_SIZE: 4096,          // ScriptProcessor buffer

    // VAD Thresholds
    SPEECH_START_THRESHOLD: 0.5,
    SPEECH_END_THRESHOLD: 0.35,
    SPEECH_PAD_FRAMES: 8,       // ~256ms padding after speech ends

    // STT
    STT_ENGINE: 'deepgram',
    DEEPGRAM_URL: 'wss://api.deepgram.com/v1/listen',

    // Buffering
    MIN_AUDIO_BUFFER_MS: 100,   // Minimum buffer before sending
    MAX_SILENCE_MS: 1500,       // Max silence before finalizing
};

// ============================================
// State
// ============================================
let state = {
    isCapturing: false,
    isSpeaking: false,
    audioContext: null,
    sourceNode: null,
    processorNode: null,
    analyserNode: null,

    // VAD
    vadSession: null,
    vadState: { h: null, c: null },
    framesSinceLastSpeech: 0,

    // STT
    sttSocket: null,
    sttApiKey: '',
    sttLanguage: 'ko',

    // Audio Buffer (for STT)
    audioBuffer: [],
    lastSpeechTime: 0,
};

// ============================================
// Message Handler
// ============================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'offscreen') return;

    console.log('[Offscreen] Received message:', message.type);

    switch (message.type) {
        case 'start-capture':
            handleStartCapture(message);
            break;

        case 'stop-capture':
            handleStopCapture();
            break;

        case 'update-config':
            if (message.apiKey) state.sttApiKey = message.apiKey;
            if (message.language) state.sttLanguage = message.language;
            break;

        case 'get-status':
            sendResponse({
                isCapturing: state.isCapturing,
                isSpeaking: state.isSpeaking,
                vadReady: !!state.vadSession,
                sttConnected: state.sttSocket?.readyState === WebSocket.OPEN
            });
            return true;
    }
});

// ============================================
// VAD Initialization (Silero-VAD WASM)
// ============================================
async function initVAD() {
    if (state.vadSession) {
        console.log('[VAD] Already initialized');
        return true;
    }

    try {
        // ONNX Runtime 설정
        if (typeof ort === 'undefined') {
            console.error('[VAD] ONNX Runtime not loaded');
            return false;
        }

        // WASM 설정은 offscreen.html에서 이미 완료됨
        // CDN에서 Silero VAD 모델 로드
        const modelUrl = window.SILERO_VAD_URL ||
            'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.19/dist/silero_vad.onnx';

        console.log('[VAD] Loading model from:', modelUrl);

        state.vadSession = await ort.InferenceSession.create(modelUrl, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all'
        });

        // RNN hidden states 초기화
        state.vadState.h = new Float32Array(2 * 1 * 64).fill(0);
        state.vadState.c = new Float32Array(2 * 1 * 64).fill(0);

        console.log('[VAD] Silero-VAD initialized successfully');
        return true;

    } catch (e) {
        console.error('[VAD] Initialization failed:', e);
        return false;
    }
}

// ============================================
// VAD Inference
// ============================================
async function runVADInference(audioData) {
    if (!state.vadSession) return 0;

    try {
        // Prepare inputs
        const inputs = {
            input: new ort.Tensor('float32', audioData, [1, audioData.length]),
            sr: new ort.Tensor('int64', new BigInt64Array([BigInt(CONFIG.SAMPLE_RATE)]), []),
            h: new ort.Tensor('float32', state.vadState.h, [2, 1, 64]),
            c: new ort.Tensor('float32', state.vadState.c, [2, 1, 64])
        };

        // Run inference
        const results = await state.vadSession.run(inputs);

        // Update RNN states
        state.vadState.h.set(results.hn.data);
        state.vadState.c.set(results.cn.data);

        return results.output.data[0]; // Speech probability

    } catch (e) {
        console.error('[VAD] Inference error:', e);
        return 0;
    }
}

// ============================================
// STT Connection (Deepgram WebSocket)
// ============================================
function connectSTT() {
    if (!state.sttApiKey) {
        console.warn('[STT] No API key configured');
        notifyUI('stt-error', { error: 'API 키가 설정되지 않았습니다.' });
        return false;
    }

    if (state.sttSocket?.readyState === WebSocket.OPEN) {
        return true;
    }

    try {
        const params = new URLSearchParams({
            model: 'nova-2',
            language: state.sttLanguage,
            punctuate: 'true',
            interim_results: 'true',  // 중간 결과 활성화 (지연 최소화)
            endpointing: '300',       // 300ms endpointing
            vad_events: 'true',
            smart_format: 'true',
            encoding: 'linear16',
            sample_rate: CONFIG.SAMPLE_RATE.toString(),
            channels: '1'
        });

        const wsUrl = `${CONFIG.DEEPGRAM_URL}?${params.toString()}`;

        state.sttSocket = new WebSocket(wsUrl, ['token', state.sttApiKey]);

        state.sttSocket.onopen = () => {
            console.log('[STT] Connected to Deepgram');
            notifyUI('stt-connected');
        };

        state.sttSocket.onmessage = (event) => {
            handleSTTResult(JSON.parse(event.data));
        };

        state.sttSocket.onerror = (error) => {
            console.error('[STT] WebSocket error:', error);
            notifyUI('stt-error', { error: 'STT 연결 오류' });
        };

        state.sttSocket.onclose = (event) => {
            console.log('[STT] Disconnected:', event.code, event.reason);
            state.sttSocket = null;

            // 캡처 중이면 재연결 시도
            if (state.isCapturing) {
                setTimeout(() => connectSTT(), 2000);
            }
        };

        return true;

    } catch (e) {
        console.error('[STT] Connection failed:', e);
        return false;
    }
}

function disconnectSTT() {
    if (state.sttSocket) {
        // Send close signal
        if (state.sttSocket.readyState === WebSocket.OPEN) {
            state.sttSocket.send(JSON.stringify({ type: 'CloseStream' }));
        }
        state.sttSocket.close();
        state.sttSocket = null;
    }
}

// ============================================
// STT Result Handler
// ============================================
function handleSTTResult(data) {
    if (data.type === 'Results') {
        const channel = data.channel;
        if (!channel?.alternatives?.[0]) return;

        const alternative = channel.alternatives[0];
        const transcript = alternative.transcript;

        if (!transcript) return;

        const isFinal = data.is_final;
        const confidence = alternative.confidence;

        // UI로 결과 전송
        notifyUI('subtitle-result', {
            text: transcript,
            isFinal: isFinal,
            confidence: confidence,
            timestamp: Date.now()
        });

        console.log(`[STT] ${isFinal ? 'Final' : 'Partial'}: "${transcript}"`);
    }

    // VAD 이벤트
    if (data.type === 'SpeechStarted') {
        notifyUI('speech-started');
    }
}

// ============================================
// Audio Capture
// ============================================
async function handleStartCapture(message) {
    if (state.isCapturing) {
        console.log('[Capture] Already capturing');
        return;
    }

    const { streamId, apiKey, language } = message;

    if (apiKey) state.sttApiKey = apiKey;
    if (language) state.sttLanguage = language;

    // VAD 초기화
    const vadReady = await initVAD();
    if (!vadReady) {
        notifyUI('capture-error', { error: 'VAD 초기화 실패' });
        return;
    }

    try {
        // Tab Audio Stream 획득
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: streamId
                }
            },
            video: false
        });

        // Audio Context 설정
        state.audioContext = new AudioContext({ sampleRate: CONFIG.SAMPLE_RATE });
        state.sourceNode = state.audioContext.createMediaStreamSource(stream);

        // Analyser (시각화용)
        state.analyserNode = state.audioContext.createAnalyser();
        state.analyserNode.fftSize = 256;

        // Audio Processor (VAD용)
        await setupAudioProcessor();

        // 오디오 체인 연결
        state.sourceNode.connect(state.analyserNode);

        // 원본 오디오도 재생 (사용자가 들을 수 있도록)
        const passthrough = state.audioContext.createGain();
        passthrough.gain.value = 1.0;
        state.sourceNode.connect(passthrough);
        passthrough.connect(state.audioContext.destination);

        state.isCapturing = true;

        // STT 연결
        if (state.sttApiKey) {
            connectSTT();
        }

        console.log('[Capture] Started successfully');
        notifyUI('capture-started');

    } catch (e) {
        console.error('[Capture] Failed to start:', e);
        notifyUI('capture-error', { error: e.message });
    }
}

// ============================================
// Audio Processor (VAD Integration)
// ============================================
async function setupAudioProcessor() {
    // AudioWorklet 사용 시도 (더 효율적)
    try {
        await state.audioContext.audioWorklet.addModule('audio-worklet-processor.js');
        state.processorNode = new AudioWorkletNode(state.audioContext, 'vad-processor', {
            processorOptions: { frameSize: CONFIG.VAD_FRAME_SIZE }
        });

        state.processorNode.port.onmessage = (e) => {
            processAudioFrame(e.data.audioData);
        };

        state.sourceNode.connect(state.processorNode);
        console.log('[AudioProcessor] Using AudioWorklet');
        return;

    } catch (e) {
        console.warn('[AudioProcessor] AudioWorklet failed, falling back to ScriptProcessor:', e);
    }

    // Fallback: ScriptProcessor (deprecated but still works)
    state.processorNode = state.audioContext.createScriptProcessor(
        CONFIG.BUFFER_SIZE, 1, 1
    );

    let frameBuffer = new Float32Array(CONFIG.VAD_FRAME_SIZE);
    let frameIndex = 0;

    state.processorNode.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);

        // VAD 프레임 크기로 분할
        for (let i = 0; i < inputData.length; i++) {
            frameBuffer[frameIndex++] = inputData[i];

            if (frameIndex >= CONFIG.VAD_FRAME_SIZE) {
                processAudioFrame(new Float32Array(frameBuffer));
                frameIndex = 0;
            }
        }
    };

    state.sourceNode.connect(state.processorNode);
    state.processorNode.connect(state.audioContext.destination);

    console.log('[AudioProcessor] Using ScriptProcessor (fallback)');
}

// ============================================
// Process Audio Frame (VAD Logic)
// ============================================
async function processAudioFrame(audioData) {
    // VAD 추론
    const probability = await runVADInference(audioData);

    const now = Date.now();
    const wasSpeaking = state.isSpeaking;

    // Speech Detection Logic
    if (probability > CONFIG.SPEECH_START_THRESHOLD) {
        // 음성 시작
        if (!state.isSpeaking) {
            state.isSpeaking = true;
            state.lastSpeechTime = now;
            console.log('[VAD] Speech started');
            notifyUI('vad-speech-start');
        }
        state.framesSinceLastSpeech = 0;

    } else if (probability < CONFIG.SPEECH_END_THRESHOLD) {
        // 음성 종료 감지
        if (state.isSpeaking) {
            state.framesSinceLastSpeech++;

            if (state.framesSinceLastSpeech > CONFIG.SPEECH_PAD_FRAMES) {
                state.isSpeaking = false;
                console.log('[VAD] Speech ended');
                notifyUI('vad-speech-end');

                // 남은 버퍼 전송 후 finalize
                flushAudioBuffer();
            }
        }
    }

    // 음성 감지 중일 때만 STT로 전송
    if (state.isSpeaking || state.framesSinceLastSpeech <= CONFIG.SPEECH_PAD_FRAMES) {
        // Audio Buffer에 추가
        state.audioBuffer.push(...audioData);

        // 일정 크기 이상이면 전송
        const minSamples = (CONFIG.MIN_AUDIO_BUFFER_MS / 1000) * CONFIG.SAMPLE_RATE;
        if (state.audioBuffer.length >= minSamples) {
            sendAudioToSTT();
        }
    }

    // 레벨 미터용 데이터
    if (probability > 0.1) {
        notifyUI('audio-level', { level: probability });
    }
}

// ============================================
// Send Audio to STT
// ============================================
function sendAudioToSTT() {
    if (!state.sttSocket || state.sttSocket.readyState !== WebSocket.OPEN) {
        return;
    }

    if (state.audioBuffer.length === 0) return;

    // Float32 -> Int16 PCM 변환
    const pcmData = float32ToInt16(state.audioBuffer);
    state.audioBuffer = [];

    // WebSocket으로 전송
    state.sttSocket.send(pcmData.buffer);
}

function flushAudioBuffer() {
    if (state.audioBuffer.length > 0) {
        sendAudioToSTT();
    }
}

// ============================================
// Float32 to Int16 Conversion
// ============================================
function float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);

    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    return int16Array;
}

// ============================================
// Stop Capture
// ============================================
function handleStopCapture() {
    console.log('[Capture] Stopping...');

    state.isCapturing = false;
    state.isSpeaking = false;

    // Flush remaining audio
    flushAudioBuffer();

    // Disconnect STT
    disconnectSTT();

    // Close Audio Context
    if (state.audioContext) {
        state.audioContext.close().catch(() => { });
        state.audioContext = null;
    }

    state.sourceNode = null;
    state.processorNode = null;
    state.analyserNode = null;
    state.audioBuffer = [];

    // Reset VAD state
    if (state.vadState.h) state.vadState.h.fill(0);
    if (state.vadState.c) state.vadState.c.fill(0);

    notifyUI('capture-stopped');
    console.log('[Capture] Stopped');
}

// ============================================
// Notify UI (via Background)
// ============================================
function notifyUI(type, data = {}) {
    chrome.runtime.sendMessage({
        type: 'subtitle-event',
        event: type,
        ...data
    }).catch(() => { });
}

// ============================================
// Initialization
// ============================================
console.log('[Offscreen] Audio Processor loaded');

// Pre-initialize VAD
initVAD().then(ready => {
    console.log('[Offscreen] VAD pre-initialization:', ready ? 'success' : 'failed');
});
