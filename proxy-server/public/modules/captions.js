// AI Captions Module - 실시간 자막 (영상 오디오 → STT)
// =====================================================
// 영상의 오디오를 캡처하여 Deepgram STT로 실시간 변환

import { AudioEnhancer } from './audio-enhancer.js';

export const Captions = {
    isActive: false,
    videoElement: null,
    captionContainer: null,
    captionHistory: [],
    maxHistoryLines: 3,

    // Audio Capture
    audioContext: null,
    sourceNode: null,
    processorNode: null,
    streamDestination: null,

    // Deepgram STT
    sttSocket: null,
    apiKey: '',

    // UI 설정
    fontSize: 'medium',
    position: 'bottom',
    bgOpacity: 0.85,
    language: 'ko',

    // 상태
    isConnecting: false,

    init(videoEl = null) {
        this.videoElement = videoEl || document.getElementById('video-player');
        this.createCaptionUI();
        this.loadSettings();
        console.log('[Captions] Initialized');
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

    async start() {
        if (this.isActive || this.isConnecting) return;

        // API 키 확인
        if (!this.apiKey) {
            this.promptApiKey();
            return;
        }

        if (!this.videoElement) {
            this.showNotification('비디오 요소를 찾을 수 없습니다.', 'error');
            return;
        }

        this.isConnecting = true;
        this.updateStatus('연결 중...');
        this.captionContainer?.classList.add('active');

        try {
            // 1. AudioContext 생성 및 비디오 오디오 캡처
            await this.setupAudioCapture();

            // 2. Deepgram WebSocket 연결
            await this.connectSTT();

            this.isActive = true;
            this.isConnecting = false;
            this.updateStatus('듣는 중...');
            console.log('[Captions] Started - Video audio capture active');

        } catch (e) {
            console.error('[Captions] Start failed:', e);
            this.isConnecting = false;
            this.updateStatus('시작 실패');
            this.showNotification(`자막 시작 실패: ${e.message}`, 'error');
            this.cleanup();
            this.captionContainer?.classList.remove('active');
        }
    },

    async setupAudioCapture() {
        const sampleRate = 16000;

        // 새 AudioContext 생성 (16kHz)
        const AC = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AC({ sampleRate: sampleRate });

        // Context가 suspended 상태면 resume
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        // MediaElementSource 생성
        try {
            this.sourceNode = this.audioContext.createMediaElementSource(this.videoElement);
            console.log('[Captions] Created MediaElementSource');
        } catch (e) {
            if (e.name === 'InvalidStateError') {
                // 이미 다른 context에 연결됨 - AudioEnhancer의 스트림 사용
                console.log('[Captions] Video already connected, trying AudioEnhancer stream...');

                // AudioEnhancer 초기화 시도
                if (!AudioEnhancer.context) {
                    AudioEnhancer.setupContext();
                }

                const stream = AudioEnhancer.getStream?.();
                if (stream) {
                    // AudioEnhancer 스트림을 새 context에서 사용
                    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
                    console.log('[Captions] Using AudioEnhancer stream');
                } else {
                    throw new Error('오디오 캡처 실패. 페이지를 새로고침 후 자막을 먼저 활성화해주세요.');
                }
            } else {
                throw e;
            }
        }

        // 원본 오디오도 들리도록 destination 연결
        this.sourceNode.connect(this.audioContext.destination);

        // ScriptProcessor로 오디오 데이터 추출 (16kHz, mono)
        const bufferSize = 4096;
        this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

        this.processorNode.onaudioprocess = (e) => {
            if (!this.isActive || !this.sttSocket || this.sttSocket.readyState !== WebSocket.OPEN) {
                return;
            }

            const inputData = e.inputBuffer.getChannelData(0);

            // Float32 -> Int16 PCM 변환
            const pcmData = this.float32ToInt16(inputData);

            // WebSocket으로 전송
            this.sttSocket.send(pcmData.buffer);
        };

        this.sourceNode.connect(this.processorNode);
        // processorNode는 destination에 연결하지 않아도 onaudioprocess가 호출됨
        // 하지만 연결해야 브라우저가 처리함
        this.processorNode.connect(this.audioContext.destination);

        console.log('[Captions] Audio capture setup complete');
    },

    async connectSTT() {
        return new Promise((resolve, reject) => {
            const params = new URLSearchParams({
                model: 'nova-2',
                language: this.language,
                punctuate: 'true',
                interim_results: 'true',
                endpointing: '300',
                smart_format: 'true',
                encoding: 'linear16',
                sample_rate: '16000',
                channels: '1'
            });

            const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

            this.sttSocket = new WebSocket(wsUrl, ['token', this.apiKey]);

            this.sttSocket.onopen = () => {
                console.log('[Captions] Deepgram connected');
                resolve();
            };

            this.sttSocket.onmessage = (event) => {
                this.handleSTTResult(JSON.parse(event.data));
            };

            this.sttSocket.onerror = (error) => {
                console.error('[Captions] WebSocket error:', error);
                reject(new Error('STT 연결 오류 - API 키를 확인해주세요.'));
            };

            this.sttSocket.onclose = (event) => {
                console.log('[Captions] Deepgram disconnected:', event.code, event.reason);
                if (this.isActive && event.code !== 1000) {
                    this.updateStatus('재연결 중...');
                    // 재연결 시도
                    setTimeout(() => {
                        if (this.isActive) {
                            this.connectSTT().catch(e => {
                                console.error('[Captions] Reconnect failed:', e);
                                this.stop();
                            });
                        }
                    }, 2000);
                }
            };

            // 타임아웃
            setTimeout(() => {
                if (this.sttSocket?.readyState === WebSocket.CONNECTING) {
                    this.sttSocket.close();
                    reject(new Error('연결 타임아웃'));
                }
            }, 10000);
        });
    },

    handleSTTResult(data) {
        if (data.type === 'Results') {
            const channel = data.channel;
            if (!channel?.alternatives?.[0]) return;

            const transcript = channel.alternatives[0].transcript;
            if (!transcript) return;

            const isFinal = data.is_final;

            // 자막 표시
            this.showCaption(transcript, isFinal);

            if (isFinal && transcript.trim()) {
                this.addToHistory(transcript);
            }

            console.log(`[Captions] ${isFinal ? '✓' : '...'} ${transcript}`);
        }
    },

    float32ToInt16(float32Array) {
        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16Array;
    },

    stop() {
        if (!this.isActive && !this.isConnecting) return;

        this.isActive = false;
        this.isConnecting = false;
        this.cleanup();

        this.captionContainer?.classList.remove('active');
        this.updateStatus(null);
        this.clearCaption();

        console.log('[Captions] Stopped');
    },

    cleanup() {
        // WebSocket 종료
        if (this.sttSocket) {
            if (this.sttSocket.readyState === WebSocket.OPEN) {
                this.sttSocket.send(JSON.stringify({ type: 'CloseStream' }));
            }
            this.sttSocket.close();
            this.sttSocket = null;
        }

        // Processor 연결 해제
        if (this.processorNode) {
            try {
                this.processorNode.disconnect();
            } catch (e) { }
            this.processorNode = null;
        }

        // Source 연결 해제
        if (this.sourceNode) {
            try {
                this.sourceNode.disconnect();
            } catch (e) { }
            this.sourceNode = null;
        }

        // AudioContext 닫기
        if (this.audioContext) {
            try {
                this.audioContext.close();
            } catch (e) { }
            this.audioContext = null;
        }
    },

    toggle() {
        if (this.isActive) {
            this.stop();
        } else {
            this.start();
        }
    },

    // API 키 입력 프롬프트
    promptApiKey() {
        const savedKey = localStorage.getItem('deepgramApiKey') || '';

        const dialog = document.createElement('div');
        dialog.id = 'caption-api-dialog';
        dialog.innerHTML = `
            <div class="caption-api-content">
                <h3>🎤 Deepgram API 키 설정</h3>
                <p>실시간 자막을 사용하려면 Deepgram API 키가 필요합니다.</p>
                <p class="caption-api-hint">
                    <a href="https://deepgram.com" target="_blank">deepgram.com</a>에서
                    무료로 API 키를 발급받을 수 있습니다. ($200 무료 크레딧)
                </p>
                <input type="password" id="caption-api-input" placeholder="API 키 입력" value="${savedKey}" />
                <div class="caption-api-buttons">
                    <button class="cancel">취소</button>
                    <button class="confirm">저장 및 시작</button>
                </div>
            </div>
        `;

        // 스타일
        const style = document.createElement('style');
        style.textContent = `
            #caption-api-dialog {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.85);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10001;
                animation: fadeIn 0.2s ease;
            }
            .caption-api-content {
                background: linear-gradient(180deg, rgba(35, 35, 50, 0.98), rgba(25, 25, 40, 0.98));
                border-radius: 16px;
                padding: 28px;
                max-width: 420px;
                width: 90%;
                color: white;
                border: 1px solid rgba(255, 255, 255, 0.1);
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            }
            .caption-api-content h3 {
                margin: 0 0 12px;
                font-size: 18px;
            }
            .caption-api-content p {
                margin: 0 0 8px;
                font-size: 14px;
                color: rgba(255, 255, 255, 0.8);
            }
            .caption-api-hint {
                font-size: 12px !important;
                color: rgba(255, 255, 255, 0.5) !important;
                margin-bottom: 16px !important;
            }
            .caption-api-hint a {
                color: #a855f7;
                text-decoration: none;
            }
            .caption-api-hint a:hover {
                text-decoration: underline;
            }
            #caption-api-input {
                width: 100%;
                padding: 14px 16px;
                margin: 8px 0 20px;
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 10px;
                color: white;
                font-size: 14px;
                outline: none;
                transition: border-color 0.2s;
                box-sizing: border-box;
            }
            #caption-api-input:focus {
                border-color: #a855f7;
            }
            .caption-api-buttons {
                display: flex;
                gap: 12px;
            }
            .caption-api-buttons button {
                flex: 1;
                padding: 14px;
                border: none;
                border-radius: 10px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                transition: all 0.2s;
            }
            .caption-api-buttons .confirm {
                background: linear-gradient(135deg, #a855f7, #6366f1);
                color: white;
            }
            .caption-api-buttons .confirm:hover {
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(168, 85, 247, 0.4);
            }
            .caption-api-buttons .cancel {
                background: rgba(255, 255, 255, 0.1);
                color: white;
            }
            .caption-api-buttons .cancel:hover {
                background: rgba(255, 255, 255, 0.15);
            }
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(dialog);

        const input = dialog.querySelector('#caption-api-input');
        input.focus();

        dialog.querySelector('.cancel').onclick = () => {
            dialog.remove();
            style.remove();
            this.captionContainer?.classList.remove('active');
        };

        dialog.querySelector('.confirm').onclick = () => {
            const key = input.value.trim();
            if (key) {
                this.apiKey = key;
                localStorage.setItem('deepgramApiKey', key);
                dialog.remove();
                style.remove();
                this.start();
            } else {
                input.style.borderColor = '#ef4444';
                input.focus();
            }
        };

        input.onkeydown = (e) => {
            if (e.key === 'Enter') dialog.querySelector('.confirm').click();
            if (e.key === 'Escape') dialog.querySelector('.cancel').click();
        };

        // 외부 클릭 시 닫기
        dialog.onclick = (e) => {
            if (e.target === dialog) dialog.querySelector('.cancel').click();
        };
    },

    // UI Methods
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
        if (!text.trim()) return;

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
        }, 5000);
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
        this.saveSettings();
    },

    setBgOpacity(opacity) {
        this.bgOpacity = opacity;
        const wrapper = this.captionContainer?.querySelector('.caption-text-wrapper');
        if (wrapper) {
            wrapper.style.setProperty('--caption-bg-opacity', opacity);
        }
        this.saveSettings();
    },

    setLanguage(lang) {
        this.language = lang;
        this.saveSettings();

        // 실행 중이면 재시작
        if (this.isActive) {
            this.stop();
            setTimeout(() => this.start(), 500);
        }
    },

    loadSettings() {
        try {
            const saved = localStorage.getItem('captionSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                this.fontSize = settings.fontSize || 'medium';
                this.position = settings.position || 'bottom';
                this.bgOpacity = settings.bgOpacity || 0.85;
                this.language = settings.language || 'ko';
            }
            this.apiKey = localStorage.getItem('deepgramApiKey') || '';
        } catch (e) { }
    },

    saveSettings() {
        const settings = {
            fontSize: this.fontSize,
            position: this.position,
            bgOpacity: this.bgOpacity,
            language: this.language
        };
        localStorage.setItem('captionSettings', JSON.stringify(settings));
    },

    showNotification(message, type = 'info') {
        const existing = document.querySelector('.caption-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = 'caption-notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 24px;
            background: ${type === 'error' ? 'rgba(239, 68, 68, 0.9)' : 'rgba(30, 30, 40, 0.95)'};
            color: white;
            border-radius: 8px;
            font-size: 14px;
            z-index: 10000;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            animation: fadeIn 0.2s ease;
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transition = 'opacity 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 4000);
    }
};
