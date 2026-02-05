// AI Captions Module - 실시간 음성 인식 + 번역 자막
// 비디오 스트림 오디오 캡처 → 음성 인식
//
// 방식 1: Web Speech API + 탭 오디오 캡처 (getDisplayMedia)
// 방식 2: 비디오 요소에서 직접 오디오 추출 → Web Audio API → 분석
//
// 참고: Web Speech API는 마이크만 지원하므로,
// 탭 오디오를 가상 마이크로 라우팅하거나 별도 ASR 사용 필요

export const Captions = {
    recognition: null,
    isActive: false,
    currentLanguage: 'ko-KR', // 인식 언어
    targetLanguage: 'en',     // 번역 대상 언어
    translateEnabled: false,

    // 오디오 캡처 관련
    audioContext: null,
    mediaStream: null,
    videoElement: null,
    captureMode: 'tab', // 'tab' (탭 오디오) 또는 'mic' (마이크)

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

    init(videoEl = null) {
        this.videoElement = videoEl;
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
        // Web Speech API 지원 확인
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            console.warn('[Captions] Speech Recognition not supported');
            return false;
        }

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
                this.showNotification('오디오 캡처 실패', 'error');
                this.stop();
            } else if (event.error === 'not-allowed') {
                this.showNotification('오디오 접근이 차단되었습니다', 'error');
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

        return true;
    },

    // 탭 오디오 캡처 시작 (getDisplayMedia 사용)
    async startTabAudioCapture() {
        try {
            // 탭 오디오 캡처를 위한 getDisplayMedia
            // preferCurrentTab: true로 현재 탭 오디오만 캡처
            this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    displaySurface: 'browser',
                    width: 1,
                    height: 1
                },
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                },
                preferCurrentTab: true,
                selfBrowserSurface: 'include',
                systemAudio: 'include'
            });

            // 비디오 트랙 제거 (오디오만 필요)
            const videoTrack = this.mediaStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.stop();
                this.mediaStream.removeTrack(videoTrack);
            }

            // 오디오 트랙 확인
            const audioTracks = this.mediaStream.getAudioTracks();
            if (audioTracks.length === 0) {
                throw new Error('No audio track captured');
            }

            console.log('[Captions] Tab audio captured:', audioTracks[0].label);
            return true;

        } catch (e) {
            console.error('[Captions] Tab audio capture failed:', e);

            if (e.name === 'NotAllowedError') {
                this.showNotification('화면/오디오 공유가 취소되었습니다', 'error');
            } else {
                this.showNotification('탭 오디오 캡처 실패. 마이크 모드로 전환합니다.', 'warning');
                this.captureMode = 'mic';
            }
            return false;
        }
    },

    // 비디오 요소에서 직접 오디오 캡처 (AudioContext 사용)
    async startVideoAudioCapture() {
        if (!this.videoElement) {
            console.error('[Captions] No video element');
            return false;
        }

        try {
            // AudioContext 생성
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // 비디오에서 오디오 소스 생성
            // 주의: 이미 AudioEnhancer에서 사용 중이면 충돌 가능
            const source = this.audioContext.createMediaElementSource(this.videoElement);

            // MediaStreamDestination으로 스트림 생성
            const destination = this.audioContext.createMediaStreamDestination();
            source.connect(destination);
            source.connect(this.audioContext.destination); // 원래 출력도 유지

            this.mediaStream = destination.stream;

            console.log('[Captions] Video audio captured');
            return true;

        } catch (e) {
            console.error('[Captions] Video audio capture failed:', e);

            if (e.message?.includes('already been connected')) {
                this.showNotification('오디오가 이미 다른 곳에서 사용 중입니다', 'warning');
            }
            return false;
        }
    },

    async start() {
        if (this.isActive) return;

        // 음성 인식 설정
        if (!this.setupRecognition()) {
            this.showNotification('음성 인식이 지원되지 않습니다', 'error');
            return;
        }

        try {
            // 캡처 모드 선택 다이얼로그
            const mode = await this.showCaptureDialog();

            if (!mode) {
                this.showNotification('자막 취소됨', 'info');
                return;
            }

            this.captureMode = mode;

            if (mode === 'tab') {
                // 탭 오디오 캡처 시도
                const success = await this.startTabAudioCapture();
                if (!success) {
                    return;
                }
            } else {
                // 마이크 모드
                await navigator.mediaDevices.getUserMedia({ audio: true });
            }

            // 음성 인식 시작
            this.recognition.start();
            this.isActive = true;
            this.captionContainer.classList.add('active');
            this.updateLangDisplay();

            const modeText = mode === 'tab' ? '탭 오디오' : '마이크';
            this.showNotification(`자막 활성화 (${modeText})`, 'success');

        } catch (e) {
            console.error('[Captions] Start failed:', e);
            this.showNotification('자막 시작 실패', 'error');
        }
    },

    // 캡처 모드 선택 다이얼로그
    showCaptureDialog() {
        return new Promise((resolve) => {
            // 기존 다이얼로그 제거
            const existing = document.querySelector('.caption-dialog');
            if (existing) existing.remove();

            const dialog = document.createElement('div');
            dialog.className = 'caption-dialog';
            dialog.innerHTML = `
                <div class="caption-dialog-content">
                    <h3>자막 오디오 소스 선택</h3>
                    <p>어떤 오디오를 인식할까요?</p>
                    <div class="caption-dialog-options">
                        <button class="caption-dialog-btn" data-mode="tab">
                            <svg viewBox="0 0 24 24" width="24" height="24">
                                <path fill="currentColor" d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z"/>
                                <path fill="currentColor" d="M9 8l7 4-7 4V8z"/>
                            </svg>
                            <span>스트림 오디오</span>
                            <small>현재 탭의 소리를 인식</small>
                        </button>
                        <button class="caption-dialog-btn" data-mode="mic">
                            <svg viewBox="0 0 24 24" width="24" height="24">
                                <path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                                <path fill="currentColor" d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                            </svg>
                            <span>마이크</span>
                            <small>내 음성을 인식</small>
                        </button>
                    </div>
                    <button class="caption-dialog-cancel">취소</button>
                </div>
            `;

            document.body.appendChild(dialog);

            // 애니메이션
            requestAnimationFrame(() => dialog.classList.add('show'));

            // 이벤트 핸들러
            dialog.querySelectorAll('.caption-dialog-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const mode = btn.dataset.mode;
                    dialog.classList.remove('show');
                    setTimeout(() => dialog.remove(), 300);
                    resolve(mode);
                });
            });

            dialog.querySelector('.caption-dialog-cancel').addEventListener('click', () => {
                dialog.classList.remove('show');
                setTimeout(() => dialog.remove(), 300);
                resolve(null);
            });

            // 배경 클릭으로 닫기
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    dialog.classList.remove('show');
                    setTimeout(() => dialog.remove(), 300);
                    resolve(null);
                }
            });
        });
    },

    stop() {
        if (!this.isActive) return;

        this.isActive = false;

        if (this.recognition) {
            this.recognition.stop();
        }

        // 미디어 스트림 정리
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        // AudioContext 정리
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
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
            const modeIcon = this.captureMode === 'tab' ? '🔊' : '🎤';
            langEl.textContent = lang ? `${modeIcon} ${lang.flag} ${lang.name}` : this.currentLanguage;
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
