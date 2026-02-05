// AI Captions Module - 실시간 음성 인식 + 번역 자막
// Web Speech API 기반

export const Captions = {
    recognition: null,
    isActive: false,
    currentLanguage: 'ko-KR', // 인식 언어
    targetLanguage: 'en',     // 번역 대상 언어
    translateEnabled: false,

    // 자막 표시 관련
    captionContainer: null,
    captionHistory: [],
    maxHistoryLines: 3,

    // 설정
    fontSize: 'medium', // small, medium, large
    position: 'bottom', // top, bottom
    bgOpacity: 0.7,

    // 지원 언어 목록
    languages: {
        'ko-KR': { name: '한국어', flag: '🇰🇷' },
        'en-US': { name: 'English', flag: '🇺🇸' },
        'ja-JP': { name: '日本語', flag: '🇯🇵' },
        'zh-CN': { name: '中文', flag: '🇨🇳' },
        'es-ES': { name: 'Español', flag: '🇪🇸' },
        'fr-FR': { name: 'Français', flag: '🇫🇷' },
        'de-DE': { name: 'Deutsch', flag: '🇩🇪' },
        'pt-BR': { name: 'Português', flag: '🇧🇷' },
        'ru-RU': { name: 'Русский', flag: '🇷🇺' },
        'vi-VN': { name: 'Tiếng Việt', flag: '🇻🇳' }
    },

    init() {
        // Web Speech API 지원 확인
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            console.warn('[Captions] Speech Recognition not supported');
            return false;
        }

        this.createCaptionUI();
        this.loadSettings();
        console.log('[Captions] Initialized');
        return true;
    },

    createCaptionUI() {
        // 자막 컨테이너
        this.captionContainer = document.createElement('div');
        this.captionContainer.id = 'caption-container';
        this.captionContainer.className = 'caption-container';
        this.captionContainer.innerHTML = `
            <div class="caption-text-wrapper">
                <div class="caption-history"></div>
                <div class="caption-current"></div>
            </div>
            <div class="caption-status">
                <span class="caption-lang"></span>
                <span class="caption-listening"></span>
            </div>
        `;

        document.getElementById('player-container')?.appendChild(this.captionContainer);
        this.updatePosition();
    },

    setupRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();

        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = this.currentLanguage;
        this.recognition.maxAlternatives = 1;

        this.recognition.onstart = () => {
            console.log('[Captions] Recognition started');
            this.updateStatus('listening');
        };

        this.recognition.onresult = async (event) => {
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

            // 중간 결과 표시
            if (interimTranscript) {
                this.showCaption(interimTranscript, false);
            }

            // 최종 결과 처리
            if (finalTranscript) {
                let displayText = finalTranscript;

                // 번역 활성화시 번역
                if (this.translateEnabled && this.targetLanguage !== this.currentLanguage.split('-')[0]) {
                    displayText = await this.translateText(finalTranscript);
                }

                this.showCaption(displayText, true);
                this.addToHistory(displayText);
            }
        };

        this.recognition.onerror = (event) => {
            console.error('[Captions] Recognition error:', event.error);

            if (event.error === 'no-speech') {
                // 음성 없음 - 계속 시도
                this.updateStatus('waiting');
            } else if (event.error === 'audio-capture') {
                this.showNotification('마이크 접근 권한이 필요합니다', 'error');
                this.stop();
            } else if (event.error === 'not-allowed') {
                this.showNotification('마이크 사용이 차단되었습니다', 'error');
                this.stop();
            }
        };

        this.recognition.onend = () => {
            console.log('[Captions] Recognition ended');
            // 자동 재시작 (활성 상태인 경우)
            if (this.isActive) {
                setTimeout(() => {
                    if (this.isActive) {
                        try {
                            this.recognition.start();
                        } catch (e) {
                            console.warn('[Captions] Restart failed:', e);
                        }
                    }
                }, 100);
            }
        };
    },

    async start() {
        if (this.isActive) return;

        this.setupRecognition();

        try {
            // 마이크 권한 요청
            await navigator.mediaDevices.getUserMedia({ audio: true });

            this.recognition.start();
            this.isActive = true;
            this.captionContainer.classList.add('active');
            this.updateLangDisplay();
            this.showNotification('자막 활성화', 'success');

        } catch (e) {
            console.error('[Captions] Start failed:', e);
            this.showNotification('마이크 접근 실패', 'error');
        }
    },

    stop() {
        if (!this.isActive) return;

        this.isActive = false;
        if (this.recognition) {
            this.recognition.stop();
        }

        this.captionContainer.classList.remove('active');
        this.clearCaption();
        this.showNotification('자막 비활성화', 'info');
    },

    toggle() {
        if (this.isActive) {
            this.stop();
        } else {
            this.start();
        }
    },

    showCaption(text, isFinal) {
        const current = this.captionContainer.querySelector('.caption-current');
        if (current) {
            current.textContent = text;
            current.classList.toggle('interim', !isFinal);
        }
    },

    clearCaption() {
        const current = this.captionContainer.querySelector('.caption-current');
        const history = this.captionContainer.querySelector('.caption-history');
        if (current) current.textContent = '';
        if (history) history.innerHTML = '';
        this.captionHistory = [];
    },

    addToHistory(text) {
        this.captionHistory.push(text);
        if (this.captionHistory.length > this.maxHistoryLines) {
            this.captionHistory.shift();
        }

        const history = this.captionContainer.querySelector('.caption-history');
        if (history) {
            history.innerHTML = this.captionHistory
                .map(t => `<div class="caption-line">${t}</div>`)
                .join('');
        }

        // 현재 자막 클리어
        const current = this.captionContainer.querySelector('.caption-current');
        if (current) current.textContent = '';
    },

    // 번역 기능 (무료 API 사용)
    async translateText(text) {
        try {
            // LibreTranslate API (무료, 셀프호스팅 가능)
            // 또는 Google Translate 무료 endpoint 사용
            const sourceLang = this.currentLanguage.split('-')[0];
            const targetLang = this.targetLanguage;

            // MyMemory Translation API (무료)
            const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}`;

            const response = await fetch(url);
            const data = await response.json();

            if (data.responseStatus === 200 && data.responseData?.translatedText) {
                return data.responseData.translatedText;
            }

            return text; // 번역 실패시 원문 반환

        } catch (e) {
            console.error('[Captions] Translation error:', e);
            return text;
        }
    },

    setLanguage(langCode) {
        this.currentLanguage = langCode;
        if (this.recognition) {
            this.recognition.lang = langCode;
        }
        this.updateLangDisplay();
        this.saveSettings();

        // 재시작
        if (this.isActive) {
            this.stop();
            setTimeout(() => this.start(), 100);
        }
    },

    setTargetLanguage(langCode) {
        this.targetLanguage = langCode;
        this.saveSettings();
        this.showNotification(`번역 언어: ${this.languages[langCode + '-' + langCode.toUpperCase()]?.name || langCode}`, 'info');
    },

    toggleTranslation() {
        this.translateEnabled = !this.translateEnabled;
        this.saveSettings();
        this.showNotification(this.translateEnabled ? '번역 활성화' : '번역 비활성화', 'info');
    },

    updateLangDisplay() {
        const langEl = this.captionContainer.querySelector('.caption-lang');
        if (langEl) {
            const lang = this.languages[this.currentLanguage];
            langEl.textContent = lang ? `${lang.flag} ${lang.name}` : this.currentLanguage;
        }
    },

    updateStatus(status) {
        const statusEl = this.captionContainer.querySelector('.caption-listening');
        if (statusEl) {
            switch (status) {
                case 'listening':
                    statusEl.innerHTML = '<span class="pulse-dot"></span> 듣는 중...';
                    break;
                case 'waiting':
                    statusEl.textContent = '대기 중...';
                    break;
                default:
                    statusEl.textContent = '';
            }
        }
    },

    updatePosition() {
        if (this.captionContainer) {
            this.captionContainer.classList.remove('position-top', 'position-bottom');
            this.captionContainer.classList.add(`position-${this.position}`);
        }
    },

    setFontSize(size) {
        this.fontSize = size;
        if (this.captionContainer) {
            this.captionContainer.classList.remove('font-small', 'font-medium', 'font-large');
            this.captionContainer.classList.add(`font-${size}`);
        }
        this.saveSettings();
    },

    setPosition(pos) {
        this.position = pos;
        this.updatePosition();
        this.saveSettings();
    },

    setBgOpacity(opacity) {
        this.bgOpacity = opacity;
        if (this.captionContainer) {
            this.captionContainer.style.setProperty('--caption-bg-opacity', opacity);
        }
        this.saveSettings();
    },

    loadSettings() {
        try {
            const saved = localStorage.getItem('captionSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                this.currentLanguage = settings.currentLanguage || 'ko-KR';
                this.targetLanguage = settings.targetLanguage || 'en';
                this.translateEnabled = settings.translateEnabled || false;
                this.fontSize = settings.fontSize || 'medium';
                this.position = settings.position || 'bottom';
                this.bgOpacity = settings.bgOpacity || 0.7;

                this.setFontSize(this.fontSize);
                this.setBgOpacity(this.bgOpacity);
            }
        } catch (e) {
            console.error('[Captions] Load settings error:', e);
        }
    },

    saveSettings() {
        try {
            localStorage.setItem('captionSettings', JSON.stringify({
                currentLanguage: this.currentLanguage,
                targetLanguage: this.targetLanguage,
                translateEnabled: this.translateEnabled,
                fontSize: this.fontSize,
                position: this.position,
                bgOpacity: this.bgOpacity
            }));
        } catch (e) {
            console.error('[Captions] Save settings error:', e);
        }
    },

    showNotification(message, type = 'info') {
        // MediaTools의 알림 시스템 재사용
        const existing = document.querySelector('.media-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = `media-notification media-notification-${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        requestAnimationFrame(() => notification.classList.add('show'));

        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 2000);
    }
};
