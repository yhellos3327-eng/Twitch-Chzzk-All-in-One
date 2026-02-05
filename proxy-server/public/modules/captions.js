// AI Captions Module - Silero-VAD 기반 실시간 음성 감지 (직접 실행 버전)
// 확장 프로그램 없이 웹 페이지 내에서 직접 오디오를 캡처하여 VAD를 실행합니다.

export const Captions = {
    isActive: false,
    isProcessing: false,
    videoElement: null,
    captionContainer: null,
    captionHistory: [],
    maxHistoryLines: 3,

    // VAD 관련
    audioContext: null,
    sourceNode: null,
    processorNode: null,
    vadSession: null,
    isModelLoading: false,
    isSpeaking: false,

    // VAD 설정
    SAMPLE_RATE: 16000,
    VAD_WINDOW_SIZE: 512,
    speechStartThreshold: 0.5,
    speechEndThreshold: 0.3,
    framesSinceLastSpeech: 0,
    SPEECH_END_FRAMES: 20,

    // UI 설정
    fontSize: 'medium',
    position: 'bottom',
    bgOpacity: 0.7,

    init(videoEl = null) {
        this.videoElement = videoEl || document.getElementById('video-player');
        this.createCaptionUI();
        this.loadSettings();
        console.log('[Captions] Initialized (Direct VAD mode)');
        return true;
    },

    createCaptionUI() {
        const existing = document.getElementById('caption-container');
        if (existing) existing.remove();

        this.captionContainer = document.createElement('div');
        this.captionContainer.id = 'caption-container';
        this.captionContainer.className = 'caption-container';
        this.captionContainer.innerHTML = `
            <div class="caption-text-wrapper">
                <div class="caption-history"></div>
                <div class="caption-current"></div>
            </div>
            <div class="caption-status">
                <span class="caption-listening"></span>
            </div>
        `;

        document.getElementById('player-container')?.appendChild(this.captionContainer);
        this.updatePosition();
        this.setFontSize(this.fontSize);
        this.setBgOpacity(this.bgOpacity);
    },

    async initVAD() {
        if (this.vadSession || this.isModelLoading) return;
        this.isModelLoading = true;
        this.updateStatus('모델 로딩 중...');

        try {
            // ONNX Runtime이 로드되었는지 확인
            if (typeof ort === 'undefined') {
                throw new Error('ONNX Runtime (ort) not found');
            }

            // WASM 경로 설정 (CDN 사용 시 필요할 수 있음)
            ort.env.wasm.numThreads = 1;

            // 실베로 VAD 모델 로드 (공용 CDN 주소 사용 시도)
            const modelUrl = 'https://cdn.jsdelivr.net/gh/dgcnz/silero-vad-onnx@master/silero_vad.onnx';
            this.vadSession = await ort.InferenceSession.create(modelUrl, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });

            console.log('[Captions] VAD Model loaded');
            this.isModelLoading = false;
        } catch (e) {
            console.error('[Captions] VAD Init failed:', e);
            this.isModelLoading = false;
            // 모델 로드 실패 시 로컬 경로로 재시도
            try {
                this.vadSession = await ort.InferenceSession.create('lib/silero_vad.onnx');
            } catch (e2) {
                this.updateStatus('모델 로드 실패');
                throw e;
            }
        }
    },

    async start() {
        if (this.isActive) return;
        if (!this.videoElement) return;

        try {
            await this.initVAD();

            // AudioContext 생성 (유저 인터랙션 후 호출되어야 함)
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: this.SAMPLE_RATE
                });
            }

            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            // 비디오 엘리먼트로부터 소스 생성
            // 주의: crossOrigin="anonymous"가 설정되어 있어야 함
            if (!this.sourceNode) {
                this.sourceNode = this.audioContext.createMediaElementSource(this.videoElement);
                // 소리를 스피커로도 보내기 위해 연결
                this.sourceNode.connect(this.audioContext.destination);
            }

            this.processorNode = this.audioContext.createScriptProcessor(this.VAD_WINDOW_SIZE, 1, 1);

            const h = new Float32Array(2 * 1 * 64).fill(0);
            const c = new Float32Array(2 * 1 * 64).fill(0);
            const sr = new BigInt64Array([BigInt(this.SAMPLE_RATE)]);

            this.processorNode.onaudioprocess = async (e) => {
                if (!this.isActive || !this.vadSession) return;

                const inputData = e.inputBuffer.getChannelData(0);

                const inputs = {
                    input: new ort.Tensor('float32', new Float32Array(inputData), [1, this.VAD_WINDOW_SIZE]),
                    sr: new ort.Tensor('int64', sr, []),
                    h: new ort.Tensor('float32', h, [2, 1, 64]),
                    c: new ort.Tensor('float32', c, [2, 1, 64])
                };

                try {
                    const results = await this.vadSession.run(inputs);
                    const probability = results.output.data[0];

                    h.set(results.hn.data);
                    c.set(results.cn.data);

                    if (probability > this.speechStartThreshold) {
                        if (!this.isSpeaking) {
                            this.isSpeaking = true;
                            this.showCaption('🎤 목소리 감지됨...', false);
                        }
                        this.framesSinceLastSpeech = 0;
                    } else {
                        if (this.isSpeaking) {
                            this.framesSinceLastSpeech++;
                            if (this.framesSinceLastSpeech > this.SPEECH_END_FRAMES) {
                                this.isSpeaking = false;
                                this.finalizeSentence();
                            }
                        }
                    }
                } catch (err) {
                    console.error('[Captions] VAD Run error:', err);
                }
            };

            this.sourceNode.connect(this.processorNode);
            this.processorNode.connect(this.audioContext.destination);

            this.isActive = true;
            this.captionContainer.classList.add('active');
            this.updateStatus('듣는 중...');
            console.log('[Captions] Direct VAD Started');

        } catch (e) {
            console.error('[Captions] Start failed:', e);
            alert('자막 기능을 시작할 수 없습니다. (CORS 문제 또는 브라우저 제한)');
        }
    },

    finalizeSentence() {
        const text = "음성이 감지되었습니다. (VAD)";
        this.showCaption(text, true);
        this.addToHistory(text);
    },

    stop() {
        if (!this.isActive) return;
        this.isActive = false;

        if (this.processorNode) {
            this.processorNode.disconnect();
            this.processorNode = null;
        }

        this.captionContainer.classList.remove('active');
        this.updateStatus(null);
        this.clearCaption();
        console.log('[Captions] Direct VAD Stopped');
    },

    toggle() {
        if (this.isActive) {
            this.stop();
        } else {
            this.start();
        }
    },

    updateStatus(text) {
        const listening = this.captionContainer?.querySelector('.caption-listening');
        if (listening) {
            if (text) {
                listening.innerHTML = `<span class="pulse-dot"></span><span>${text}</span>`;
            } else {
                listening.innerHTML = '';
            }
        }
    },

    showCaption(text, isFinal) {
        const current = this.captionContainer?.querySelector('.caption-current');
        if (current) {
            current.textContent = text;
            current.classList.toggle('interim', !isFinal);
        }
    },

    clearCaption() {
        const current = this.captionContainer?.querySelector('.caption-current');
        const history = this.captionContainer?.querySelector('.caption-history');
        if (current) current.textContent = '';
        if (history) history.innerHTML = '';
        this.captionHistory = [];
    },

    addToHistory(text) {
        this.captionHistory.push(text);
        if (this.captionHistory.length > this.maxHistoryLines) {
            this.captionHistory.shift();
        }

        const history = this.captionContainer?.querySelector('.caption-history');
        if (history) {
            history.innerHTML = this.captionHistory
                .map(t => `<div class="caption-line">${t}</div>`)
                .join('');
        }

        setTimeout(() => {
            const current = this.captionContainer?.querySelector('.caption-current');
            if (current && current.textContent === text) {
                current.textContent = '';
            }
        }, 3000);
    },

    updatePosition() {
        if (!this.captionContainer) return;
        this.captionContainer.classList.remove('position-top', 'position-bottom');
        this.captionContainer.classList.add(`position-${this.position}`);
    },

    setFontSize(size) {
        this.fontSize = size;
        if (this.captionContainer) {
            this.captionContainer.classList.remove('font-small', 'font-medium', 'font-large');
            this.captionContainer.classList.add(`font-${size}`);
        }
    },

    setBgOpacity(opacity) {
        this.bgOpacity = opacity;
        if (this.captionContainer) {
            this.captionContainer.style.setProperty('--caption-bg-opacity', opacity);
        }
    },

    loadSettings() {
        try {
            const saved = localStorage.getItem('captionSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                this.fontSize = settings.fontSize || 'medium';
                this.position = settings.position || 'bottom';
                this.bgOpacity = settings.bgOpacity || 0.7;
            }
        } catch (e) { }
    },

    saveSettings() {
        const settings = {
            fontSize: this.fontSize,
            position: this.position,
            bgOpacity: this.bgOpacity
        };
        localStorage.setItem('captionSettings', JSON.stringify(settings));
    }
};
