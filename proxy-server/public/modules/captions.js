// AI Captions Module - 실시간 자막 + 한국어 번역
// =====================================================
// 영상의 오디오를 캡처하여 Deepgram STT로 변환 후 한국어로 번역

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
    gainNode: null,

    // Deepgram STT
    sttSocket: null,
    apiKey: '',

    // UI 설정
    fontSize: 'medium',
    position: 'bottom',
    bgOpacity: 0.85,

    // 언어 설정: 자동 감지 후 한국어로 번역
    sourceLanguage: 'multi',  // 소스 언어 (multi = 다국어 자동 감지)
    translateToKorean: true,  // 한국어 번역 활성화

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
                <div class="caption-translated"></div>
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
            this.updateStatus('듣는 중... (자동 감지 → 한글)');
            console.log('[Captions] Started - Auto-detect + Korean translation');

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
                    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
                    console.log('[Captions] Using AudioEnhancer stream');
                } else {
                    throw new Error('오디오 캡처 실패. 페이지를 새로고침 후 자막을 먼저 활성화해주세요.');
                }
            } else {
                throw e;
            }
        }

        // GainNode 생성 (오디오 출력용 - 1개만 destination에 연결)
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 1.0;

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

        // 오디오 체인 구성 (소리 중첩 방지)
        // Source -> GainNode -> Destination (오디오 출력)
        // Source -> Processor (STT 데이터 추출, destination 미연결)
        this.sourceNode.connect(this.gainNode);
        this.gainNode.connect(this.audioContext.destination);

        // Processor는 데이터 추출만 하고 destination에 연결하지 않음
        this.sourceNode.connect(this.processorNode);
        // processorNode를 빈 GainNode에 연결 (onaudioprocess 호출을 위해 필요)
        const silentGain = this.audioContext.createGain();
        silentGain.gain.value = 0; // 무음
        this.processorNode.connect(silentGain);
        silentGain.connect(this.audioContext.destination);

        console.log('[Captions] Audio capture setup complete (no audio duplication)');
    },

    async connectSTT() {
        return new Promise((resolve, reject) => {
            // Deepgram 파라미터 설정
            const params = new URLSearchParams({
                model: 'nova-2',
                punctuate: 'true',
                interim_results: 'true',
                endpointing: '300',
                smart_format: 'true',
                encoding: 'linear16',
                sample_rate: '16000',
                channels: '1'
            });

            // 다국어 자동 감지 + 한국어 번역
            if (this.translateToKorean) {
                // detect_language: 다국어 자동 감지
                // language: 없음 (자동 감지)
                params.set('detect_language', 'true');
                params.set('translate', 'ko'); // 한국어로 번역
            } else {
                params.set('language', this.sourceLanguage);
            }

            const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
            console.log('[Captions] Connecting with translation to Korean');

            this.sttSocket = new WebSocket(wsUrl, ['token', this.apiKey]);

            this.sttSocket.onopen = () => {
                console.log('[Captions] Deepgram connected (auto-detect + Korean translation)');
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

            const alt = channel.alternatives[0];
            const transcript = alt.transcript;
            if (!transcript) return;

            const isFinal = data.is_final;

            // 감지된 언어 정보
            const detectedLang = data.metadata?.detected_language || channel.detected_language;

            // 번역된 텍스트 표시
            this.showCaption(transcript, isFinal, detectedLang);

            if (isFinal && transcript.trim()) {
                this.addToHistory(transcript);
            }

            const langInfo = detectedLang ? ` [${detectedLang}]` : '';
            console.log(`[Captions] ${isFinal ? '✓' : '...'}${langInfo} ${transcript}`);
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
            try { this.processorNode.disconnect(); } catch (e) { }
            this.processorNode = null;
        }

        // GainNode 연결 해제
        if (this.gainNode) {
            try { this.gainNode.disconnect(); } catch (e) { }
            this.gainNode = null;
        }

        // Source 연결 해제
        if (this.sourceNode) {
            try { this.sourceNode.disconnect(); } catch (e) { }
            this.sourceNode = null;
        }

        // AudioContext 닫기
        if (this.audioContext) {
            try { this.audioContext.close(); } catch (e) { }
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

    // 번역 모드 토글
    toggleTranslation() {
        this.translateToKorean = !this.translateToKorean;
        this.saveSettings();

        const msg = this.translateToKorean
            ? '한국어 번역 활성화'
            : '원본 언어 표시';
        this.showNotification(msg, 'info');

        // 실행 중이면 재시작
        if (this.isActive) {
            this.stop();
            setTimeout(() => this.start(), 500);
        }
    },

    // API 키 입력 프롬프트
    promptApiKey() {
        const savedKey = localStorage.getItem('deepgramApiKey') || '';

        const dialog = document.createElement('div');
        dialog.id = 'caption-api-dialog';
        dialog.innerHTML = `
            <div class="caption-api-content">
                <h3>🎤 실시간 자막 설정</h3>
                <p>영상 음성을 자동으로 인식하고 한국어로 번역합니다.</p>
                <p class="caption-api-hint">
                    <a href="https://deepgram.com" target="_blank">deepgram.com</a>에서
                    무료 API 키를 발급받으세요. ($200 크레딧 제공)
                </p>
                <input type="password" id="caption-api-input" placeholder="Deepgram API 키" value="${savedKey}" />

                <div class="caption-option">
                    <label>
                        <input type="checkbox" id="caption-translate-toggle" ${this.translateToKorean ? 'checked' : ''} />
                        <span>다국어 자동 감지 + 한국어 번역</span>
                    </label>
                </div>

                <div class="caption-api-buttons">
                    <button class="cancel">취소</button>
                    <button class="confirm">시작</button>
                </div>
            </div>
        `;

        // 스타일
        const style = document.createElement('style');
        style.id = 'caption-dialog-style';
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
                margin: 8px 0 16px;
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
            .caption-option {
                margin-bottom: 20px;
                padding: 12px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 8px;
            }
            .caption-option label {
                display: flex;
                align-items: center;
                gap: 10px;
                cursor: pointer;
                font-size: 13px;
                color: rgba(255, 255, 255, 0.9);
            }
            .caption-option input[type="checkbox"] {
                width: 18px;
                height: 18px;
                accent-color: #a855f7;
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
        const translateToggle = dialog.querySelector('#caption-translate-toggle');
        input.focus();

        const closeDialog = () => {
            dialog.remove();
            style.remove();
            this.captionContainer?.classList.remove('active');
        };

        dialog.querySelector('.cancel').onclick = closeDialog;

        dialog.querySelector('.confirm').onclick = () => {
            const key = input.value.trim();
            if (key) {
                this.apiKey = key;
                this.translateToKorean = translateToggle.checked;
                localStorage.setItem('deepgramApiKey', key);
                this.saveSettings();
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
            if (e.key === 'Escape') closeDialog();
        };

        dialog.onclick = (e) => {
            if (e.target === dialog) closeDialog();
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

    showCaption(text, isFinal, detectedLang = null) {
        const current = this.captionContainer?.querySelector('.caption-current');
        if (current) {
            current.textContent = text;
            current.classList.toggle('interim', !isFinal);

            // 감지된 언어 표시 (옵션)
            if (detectedLang && this.translateToKorean) {
                current.setAttribute('data-lang', detectedLang.toUpperCase());
            } else {
                current.removeAttribute('data-lang');
            }
        }
    },

    clearCaption() {
        const current = this.captionContainer?.querySelector('.caption-current');
        const history = this.captionContainer?.querySelector('.caption-history');
        const translated = this.captionContainer?.querySelector('.caption-translated');
        if (current) current.textContent = '';
        if (history) history.innerHTML = '';
        if (translated) translated.textContent = '';
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

    loadSettings() {
        try {
            const saved = localStorage.getItem('captionSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                this.fontSize = settings.fontSize || 'medium';
                this.position = settings.position || 'bottom';
                this.bgOpacity = settings.bgOpacity || 0.85;
                this.translateToKorean = settings.translateToKorean !== false; // 기본값 true
            }
            this.apiKey = localStorage.getItem('deepgramApiKey') || '';
        } catch (e) { }
    },

    saveSettings() {
        const settings = {
            fontSize: this.fontSize,
            position: this.position,
            bgOpacity: this.bgOpacity,
            translateToKorean: this.translateToKorean
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
