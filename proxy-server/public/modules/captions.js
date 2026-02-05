// AI Captions Module - Silero-VAD 기반 실시간 음성 감지 (확장 프로그램 연동)
// 기존 Whisper 로직을 제거하고, 확장 프로그램의 VAD 로직을 사용하도록 변경함.

export const Captions = {
    isActive: false,
    videoElement: null,
    captionContainer: null,
    captionHistory: [],
    maxHistoryLines: 3,

    // 설정
    fontSize: 'medium',
    position: 'bottom',
    bgOpacity: 0.7,

    init(videoEl = null) {
        this.videoElement = videoEl || document.getElementById('video-player');
        this.createCaptionUI();
        this.loadSettings();

        // 확장 프로그램으로부터 메시지 수신 대기
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener((message) => {
                if (message.type === 'subtitle-result' && this.isActive) {
                    this.showCaption(message.text, true);
                    this.addToHistory(message.text);
                }
            });
        }

        console.log('[Captions] Initialized with VAD bridge');
        return true;
    },

    createCaptionUI() {
        // 기존 UI 제거 (재초기화 시)
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

    updatePosition() {
        if (!this.captionContainer) return;
        this.captionContainer.classList.remove('position-top', 'position-bottom');
        this.captionContainer.classList.add(`position-${this.position}`);
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

    async start() {
        if (this.isActive) return;

        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            try {
                this.isActive = true;
                this.captionContainer.classList.add('active');
                this.updateStatus('듣는 중...');

                await chrome.runtime.sendMessage({ type: 'START_SUBTITLE' });
                console.log('[Captions] VAD Started via extension');
            } catch (e) {
                console.error('[Captions] Failed to start:', e);
                this.isActive = false;
                this.captionContainer.classList.remove('active');
                alert('확장 프로그램 연결에 실패했습니다.');
            }
        } else {
            alert('자막 기능을 사용하려면 확장 프로그램이 필요합니다.');
        }
    },

    stop() {
        if (!this.isActive) return;
        this.isActive = false;
        this.captionContainer.classList.remove('active');
        this.updateStatus(null);
        this.clearCaption();

        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ type: 'STOP_SUBTITLE' });
        }
        console.log('[Captions] VAD Stopped');
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

        // 5초 후 자동으로 현재 텍스트 비우기
        setTimeout(() => {
            const current = this.captionContainer.querySelector('.caption-current');
            if (current && current.textContent === text) {
                current.textContent = '';
            }
        }, 5000);
    },

    setFontSize(size) {
        this.fontSize = size;
        if (this.captionContainer) {
            this.captionContainer.classList.remove('font-small', 'font-medium', 'font-large');
            this.captionContainer.classList.add(`font-${size}`);
        }
    },

    setPosition(pos) {
        this.position = pos;
        this.updatePosition();
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
