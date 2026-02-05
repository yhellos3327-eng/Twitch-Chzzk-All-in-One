// AI Captions Module - @ricky0123/vad-web 기반 실시간 음성 감지
// 라이브러리를 사용하여 브라우저에서 직접 음성을 감지합니다.

import { AudioEnhancer } from './audio-enhancer.js';

export const Captions = {
    isActive: false,
    videoElement: null,
    captionContainer: null,
    captionHistory: [],
    maxHistoryLines: 3,

    // VAD 관련
    myvad: null,

    // UI 설정
    fontSize: 'medium',
    position: 'bottom',
    bgOpacity: 0.7,

    init(videoEl = null) {
        this.videoElement = videoEl || document.getElementById('video-player');
        this.createCaptionUI();
        this.loadSettings();
        console.log('[Captions] Initialized (VAD-Web Library mode)');
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
        if (this.isActive) return;
        if (!this.videoElement) {
            console.error('[Captions] No video element found');
            return;
        }

        try {
            this.updateStatus('VAD 초기화 중...');

            // VAD 라이브러리가 로드되었는지 확인
            if (typeof vad === 'undefined') {
                throw new Error('VAD library (vad) not found. Check bundle.min.js loading.');
            }

            // AudioEnhancer를 통해 오디오 스트림 가져오기 (CORS 및 중복 연결 문제 해결)
            const stream = AudioEnhancer.getStream();

            if (!stream) {
                throw new Error('오디오 스트림을 가져올 수 없습니다. 비디오가 로드되었는지 확인해주세요.');
            }

            // VAD 인스턴스 생성
            this.myvad = await vad.MicVAD.new({
                stream: stream,
                onSpeechStart: () => {
                    this.showCaption('🎤 목소리 감지 중...', false);
                },
                onSpeechEnd: (audio) => {
                    this.finalizeSentence();
                },
                onVADMisfire: () => {
                    this.showCaption('', false);
                }
            });

            this.myvad.start();
            this.isActive = true;
            this.captionContainer.classList.add('active');
            this.updateStatus('듣는 중...');
            console.log('[Captions] VAD Started with shared stream from AudioEnhancer');

        } catch (e) {
            console.error('[Captions] Start failed:', e);
            this.updateStatus('시작 실패');
            alert(`자막 기능을 시작할 수 없습니다: ${e.message}`);
        }
    },

    finalizeSentence() {
        const text = "음성이 감지되었습니다.";
        this.showCaption(text, true);
        this.addToHistory(text);
    },

    stop() {
        if (!this.isActive) return;
        this.isActive = false;

        if (this.myvad) {
            this.myvad.pause();
            this.myvad = null;
        }

        this.captionContainer.classList.remove('active');
        this.updateStatus(null);
        this.clearCaption();
        console.log('[Captions] VAD Stopped');
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
