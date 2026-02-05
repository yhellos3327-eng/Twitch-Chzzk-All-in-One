/**
 * Offscreen Document - Audio Processor
 * Handles Web Audio API, Silero-VAD (WASM), and streaming to STT engine.
 */

let audioContext;
let processorNode;
let sourceNode;
let vadSession;
let isSpeaking = false;
let speechStartThreshold = 0.5;
let speechEndThreshold = 0.3;
let framesSinceLastSpeech = 0;
const SPEECH_END_FRAMES = 20; // ~0.6s at 16kHz/512 window

// STT Engine Mock (Deepgram or similar would be implemented here via WebSocket)
let sttEnabled = false;

// Audio Configuration
const SAMPLE_RATE = 16000;
const VAD_WINDOW_SIZE = 512;

// Message Listener
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.target !== 'offscreen') return;

    if (message.type === 'start-capture') {
        startCapture(message.streamId);
    } else if (message.type === 'stop-capture') {
        stopCapture();
    }
});

async function initVAD() {
    if (vadSession) return;
    try {
        ort.env.wasm.wasmPaths = 'lib/';
        vadSession = await ort.InferenceSession.create('lib/silero_vad.onnx', {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all'
        });
        console.log('VAD Session initialized');
    } catch (e) {
        console.error('Failed to initialize VAD:', e);
    }
}

async function startCapture(streamId) {
    if (audioContext) return;

    await initVAD();

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: streamId
                }
            },
            video: false
        });

        audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
        sourceNode = audioContext.createMediaStreamSource(stream);

        processorNode = audioContext.createScriptProcessor(VAD_WINDOW_SIZE, 1, 1);

        const h = new Float32Array(2 * 1 * 64).fill(0);
        const c = new Float32Array(2 * 1 * 64).fill(0);
        const sr = new BigInt64Array([BigInt(SAMPLE_RATE)]);

        processorNode.onaudioprocess = async (e) => {
            const inputData = e.inputBuffer.getChannelData(0);

            // Run VAD Inference
            const inputs = {
                input: new ort.Tensor('float32', new Float32Array(inputData), [1, VAD_WINDOW_SIZE]),
                sr: new ort.Tensor('int64', sr, []),
                h: new ort.Tensor('float32', h, [2, 1, 64]),
                c: new ort.Tensor('float32', c, [2, 1, 64])
            };

            const results = await vadSession.run(inputs);
            const probability = results.output.data[0];

            // Update RNN states
            h.set(results.hn.data);
            c.set(results.cn.data);

            if (probability > speechStartThreshold) {
                if (!isSpeaking) {
                    isSpeaking = true;
                    console.log('Speech detected');
                }
                framesSinceLastSpeech = 0;
                sendToSTT(inputData);
            } else {
                if (isSpeaking) {
                    framesSinceLastSpeech++;
                    if (framesSinceLastSpeech > SPEECH_END_FRAMES) {
                        isSpeaking = false;
                        console.log('Speech ended');
                        finalizeSpeech();
                    } else {
                        sendToSTT(inputData);
                    }
                }
            }
        };

        sourceNode.connect(processorNode);
        processorNode.connect(audioContext.destination);

        // Keep audio playing
        const destination = audioContext.createMediaStreamDestination();
        sourceNode.connect(destination);

        console.log('Capture started in offscreen');
        sttEnabled = true;
    } catch (e) {
        console.error('Error starting capture:', e);
    }
}

function stopCapture() {
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    sttEnabled = false;
    console.log('Capture stopped in offscreen');
}

function sendToSTT(audioBuffer) {
    if (!sttEnabled) return;
    // In real implementation: sttSocket.send(audioBuffer)
}

function finalizeSpeech() {
    // Simulate STT result after speech ends
    chrome.runtime.sendMessage({
        type: 'subtitle-result',
        text: '목소리가 감지되었습니다. (VAD 활성화됨)'
    });
}

initVAD();
