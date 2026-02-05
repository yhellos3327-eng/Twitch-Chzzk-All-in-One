// AI Captions Module - 실시간 자막 표시
// =====================================
// 두 가지 모드 지원:
// 1. Extension Mode: Background에서 VAD+STT 처리 후 전달받은 텍스트 표시
// 2. Standalone Mode: Web Speech API 사용 (마이크 입력)

export const Captions = {
    isActive: false,
    videoElement: null,
    captionContainer: null,
    captionHistory: [],
    maxHistoryLines: 3,

    // Mode
    mode: 'standalone', // 'extension' | 'standalone'

    // Standalone: Speech Recognition
    recognition: null,
    isListening: false,

    // UI 설정
    fontSize: 'medium',
    position: 'bottom',
    bgOpacity: 0.85,

    // 언어 설정
    language: 'ko-KR',

    init(videoEl = null) {
        this.videoElement = videoEl || document.getElementById('video-player');
        this.createCaptionUI();
        this.loadSettings();
        this.setupExtensionListener();
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

    // Extension 메시지 리스너 설정
    setupExtensionListener() {
        // Chrome Extension 환경인지 확인
        if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                this.handleExtensionMessage(message);
            });
            console.log('[Captions] Extension listener registered');
        }
    },

    // Extension에서 오는 메시지 처리
    handleExtensionMessage(message) {
        switch (message.type) {
            case 'SUBTITLE_TEXT':
                if (this.isActive) {
                    this.showCaption(message.text, message.isFinal);
                    if (message.isFinal) {
                        this.addToHistory(message.text);
                    }
                }
                break;

            case 'SUBTITLE_STARTED':
                this.isActive = true;
                this.mode = 'extension';
                this.captionContainer?.classList.add('active');
                this.updateStatus('연결됨 (VAD+STT)');
                console.log('[Captions] Extension subtitle started');
                break;

            case 'SUBTITLE_STOPPED':
                if (this.mode === 'extension') {
                    this.isActive = false;
                    this.captionContainer?.classList.remove('active');
                    this.updateStatus(null);
                    this.clearCaption();
                    console.log('[Captions] Extension subtitle stopped');
                }
                break;

            case 'SUBTITLE_SPEECH_START':
                this.updateStatus('음성 감지됨...');
                break;

            case 'SUBTITLE_SPEECH_END':
                this.updateStatus('듣는 중...');
                break;

            case 'SUBTITLE_ERROR':
                this.updateStatus(`오류: ${message.error}`);
                this.showNotification(message.error, 'error');
                break;

            case 'SUBTITLE_AUDIO_LEVEL':
                // 오디오 레벨 표시 (선택적)
                break;
        }
    },

    // Extension을 통한 자막 시작
    async startWithExtension() {
        if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
            this.showNotification('확장 프로그램 환경이 아닙니다.', 'error');
            return false;
        }

        try {
            const response = await chrome.runtime.sendMessage({ type: 'START_SUBTITLE' });

            if (response?.success) {
                this.mode = 'extension';
                this.isActive = true;
                this.captionContainer?.classList.add('active');
                this.updateStatus('초기화 중...');
                return true;
            } else {
                this.showNotification(response?.error || '자막 시작 실패', 'error');
                return false;
            }
        } catch (e) {
            console.error('[Captions] Extension start failed:', e);
            this.showNotification('확장 프로그램 연결 실패', 'error');
            return false;
        }
    },

    // Extension을 통한 자막 중지
    async stopWithExtension() {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            try {
                await chrome.runtime.sendMessage({ type: 'STOP_SUBTITLE' });
            } catch (e) {
                console.warn('[Captions] Extension stop failed:', e);
            }
        }

        this.isActive = false;
        this.captionContainer?.classList.remove('active');
        this.updateStatus(null);
        this.clearCaption();
    },

    // Standalone 모드: Web Speech API
    checkSpeechRecognitionSupport() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            return { supported: false, reason: '이 브라우저는 음성 인식을 지원하지 않습니다.' };
        }
        return { supported: true };
    },

    async startStandalone() {
        const support = this.checkSpeechRecognitionSupport();
        if (!support.supported) {
            this.showNotification(support.reason, 'error');
            return false;
        }

        try {
            this.updateStatus('초기화 중...');

            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();

            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = this.language;
            this.recognition.maxAlternatives = 1;

            this.recognition.onstart = () => {
                this.isListening = true;
                this.updateStatus('듣는 중... (마이크)');
            };

            this.recognition.onresult = (event) => {
                this.handleSpeechResult(event);
            };

            this.recognition.onerror = (event) => {
                console.error('[Captions] Speech error:', event.error);
                if (event.error === 'no-speech') {
                    this.updateStatus('음성 대기 중...');
                } else if (event.error === 'not-allowed') {
                    this.updateStatus('권한 거부됨');
                    this.showNotification('마이크 권한이 필요합니다.', 'error');
                    this.stop();
                }
            };

            this.recognition.onend = () => {
                if (this.isActive && this.isListening && this.mode === 'standalone') {
                    setTimeout(() => {
                        if (this.isActive) {
                            try { this.recognition.start(); } catch (e) { }
                        }
                    }, 100);
                }
            };

            this.recognition.start();
            this.mode = 'standalone';
            this.isActive = true;
            this.captionContainer?.classList.add('active');
            return true;

        } catch (e) {
            console.error('[Captions] Standalone start failed:', e);
            this.showNotification(`시작 실패: ${e.message}`, 'error');
            return false;
        }
    },

    handleSpeechResult(event) {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        if (interimTranscript) {
            this.showCaption(interimTranscript, false);
        }

        if (finalTranscript) {
            this.showCaption(finalTranscript, true);
            this.addToHistory(finalTranscript);
        }
    },

    // 자막 시작 (자동 모드 선택)
    async start() {
        if (this.isActive) return;

        // Extension 모드 우선 시도
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            const success = await this.startWithExtension();
            if (success) return;
        }

        // Fallback: Standalone 모드
        await this.startStandalone();
    },

    // 자막 중지
    stop() {
        if (!this.isActive) return;

        if (this.mode === 'extension') {
            this.stopWithExtension();
        } else {
            this.isListening = false;
            if (this.recognition) {
                try { this.recognition.stop(); } catch (e) { }
                this.recognition = null;
            }
        }

        this.isActive = false;
        this.captionContainer?.classList.remove('active');
        this.updateStatus(null);
        this.clearCaption();
        console.log('[Captions] Stopped');
    },

    toggle() {
        if (this.isActive) {
            this.stop();
        } else {
            this.start();
        }
    },

    // 언어 변경
    setLanguage(lang) {
        this.language = lang;
        this.saveSettings();

        if (this.isActive && this.mode === 'standalone') {
            this.stop();
            setTimeout(() => this.start(), 300);
        }
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
    },

    setBgOpacity(opacity) {
        this.bgOpacity = opacity;
        const wrapper = this.captionContainer?.querySelector('.caption-text-wrapper');
        if (wrapper) {
            wrapper.style.setProperty('--caption-bg-opacity', opacity);
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
                this.language = settings.language || 'ko-KR';
            }
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
        notification.className = `caption-notification`;
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
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transition = 'opacity 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
};
