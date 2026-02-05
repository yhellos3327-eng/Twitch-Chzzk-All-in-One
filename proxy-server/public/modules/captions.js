// AI Captions Module - Whisper.js 기반 실시간 음성 인식
// 비디오 오디오 추출 → Whisper tiny 모델로 음성 인식
// 
// Transformers.js 사용 - 브라우저에서 로컬 실행
// 모델: whisper-tiny (~40MB, 첫 로딩 후 캐시됨)

export const Captions = {
    // Whisper 관련
    pipeline: null,
    isModelLoading: false,
    isModelLoaded: false,

    // 상태
    isActive: false,
    isProcessing: false,
    currentLanguage: 'ko', // 인식 언어 (ko, en, ja, zh 등)
    targetLanguage: 'en',  // 번역 대상 언어
    translateEnabled: false,

    // 오디오 캡처 관련
    audioContext: null,
    mediaStream: null,
    videoElement: null,
    audioRecorder: null,
    recordingInterval: null,
    chunkDuration: 5000, // 5초마다 인식

    // 자막 표시 관련
    captionContainer: null,
    captionHistory: [],
    maxHistoryLines: 3,

    // 설정
    fontSize: 'medium',
    position: 'bottom',
    bgOpacity: 0.7,

    // 지원 언어
    languages: {
        'ko': { name: '한국어', flag: '🇰🇷' },
        'en': { name: 'English', flag: '🇺🇸' },
        'ja': { name: '日本語', flag: '🇯🇵' },
        'zh': { name: '中文', flag: '🇨🇳' },
        'es': { name: 'Español', flag: '🇪🇸' },
        'fr': { name: 'Français', flag: '🇫🇷' },
        'de': { name: 'Deutsch', flag: '🇩🇪' },
        'pt': { name: 'Português', flag: '🇧🇷' },
        'ru': { name: 'Русский', flag: '🇷🇺' },
        'vi': { name: 'Tiếng Việt', flag: '🇻🇳' }
    },

    init(videoEl = null) {
        this.videoElement = videoEl || document.getElementById('video-player');
        this.createCaptionUI();
        this.loadSettings();
        console.log('[Captions] Initialized');
        return true;
    },

    createCaptionUI() {
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

    // Whisper 모델 로드
    async loadWhisperModel() {
        if (this.isModelLoaded || this.isModelLoading) return;

        this.isModelLoading = true;
        this.updateStatus('loading');
        this.showNotification('AI 모델 로딩 중... (최초 1회, ~40MB)', 'info');

        try {
            // Transformers.js 동적 로드
            if (!window.Transformers) {
                await this.loadScript('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1');
            }

            const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1');

            // Whisper tiny 모델 로드 (가장 가벼움)
            this.pipeline = await pipeline(
                'automatic-speech-recognition',
                'Xenova/whisper-tiny',
                {
                    progress_callback: (progress) => {
                        if (progress.status === 'downloading') {
                            const percent = Math.round((progress.loaded / progress.total) * 100);
                            this.updateStatus(`다운로드 ${percent}%`);
                        }
                    }
                }
            );

            this.isModelLoaded = true;
            this.isModelLoading = false;
            this.showNotification('AI 모델 로드 완료!', 'success');
            console.log('[Captions] Whisper model loaded');

        } catch (e) {
            console.error('[Captions] Model load failed:', e);
            this.isModelLoading = false;
            this.showNotification('모델 로드 실패', 'error');
            throw e;
        }
    },

    loadScript(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.type = 'module';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    },

    // 비디오에서 오디오 스트림 캡처
    async captureVideoAudio() {
        if (!this.videoElement) {
            throw new Error('Video element not found');
        }

        try {
            // 비디오 요소에서 직접 스트림 캡처
            if (this.videoElement.captureStream) {
                const stream = this.videoElement.captureStream();
                const audioTracks = stream.getAudioTracks();

                if (audioTracks.length === 0) {
                    throw new Error('No audio track in video');
                }

                this.mediaStream = new MediaStream(audioTracks);
                console.log('[Captions] Video audio captured');
                return true;
            }

            // 폴백: getDisplayMedia 사용
            this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: { width: 1, height: 1 },
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                },
                preferCurrentTab: true,
                selfBrowserSurface: 'include',
                systemAudio: 'include'
            });

            // 비디오 트랙 제거
            const videoTrack = this.mediaStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.stop();
                this.mediaStream.removeTrack(videoTrack);
            }

            return true;

        } catch (e) {
            console.error('[Captions] Audio capture failed:', e);
            if (e.name === 'NotAllowedError') {
                this.showNotification('오디오 접근이 거부되었습니다', 'error');
            }
            return false;
        }
    },

    // 오디오 녹음 및 인식 시작
    startRecordingLoop() {
        const audioChunks = [];

        // MediaRecorder 설정
        this.audioRecorder = new MediaRecorder(this.mediaStream, {
            mimeType: 'audio/webm;codecs=opus'
        });

        this.audioRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        this.audioRecorder.onstop = async () => {
            if (audioChunks.length === 0 || !this.isActive) return;

            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            audioChunks.length = 0; // 초기화

            // 음성 인식 처리
            await this.processAudio(audioBlob);

            // 다음 녹음 시작
            if (this.isActive && this.audioRecorder) {
                this.audioRecorder.start();
            }
        };

        // 첫 녹음 시작
        this.audioRecorder.start();

        // 주기적으로 녹음 중지하여 인식
        this.recordingInterval = setInterval(() => {
            if (this.audioRecorder && this.audioRecorder.state === 'recording' && !this.isProcessing) {
                this.audioRecorder.stop();
            }
        }, this.chunkDuration);
    },

    // 오디오를 Whisper로 처리
    async processAudio(audioBlob) {
        if (!this.pipeline || this.isProcessing) return;

        this.isProcessing = true;
        this.updateStatus('인식 중...');

        try {
            // Blob을 ArrayBuffer로 변환
            const arrayBuffer = await audioBlob.arrayBuffer();

            // AudioContext로 디코딩
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            // 16kHz로 리샘플링 (Whisper 요구사항)
            const targetSampleRate = 16000;
            const audioData = this.resampleAudio(audioBuffer, targetSampleRate);

            // Whisper 인식
            const result = await this.pipeline(audioData, {
                language: this.currentLanguage,
                task: 'transcribe',
                chunk_length_s: 30,
                stride_length_s: 5
            });

            if (result && result.text && result.text.trim()) {
                let displayText = result.text.trim();

                // 번역 (활성화된 경우)
                if (this.translateEnabled && this.targetLanguage !== this.currentLanguage) {
                    displayText = await this.translateText(displayText);
                }

                this.showCaption(displayText, true);
                this.addToHistory(displayText);
            }

            audioContext.close();

        } catch (e) {
            console.error('[Captions] Speech recognition failed:', e);
        } finally {
            this.isProcessing = false;
            this.updateStatus('듣는 중...');
        }
    },

    // 오디오 리샘플링
    resampleAudio(audioBuffer, targetSampleRate) {
        const sourceSampleRate = audioBuffer.sampleRate;
        const sourceData = audioBuffer.getChannelData(0); // 모노

        if (sourceSampleRate === targetSampleRate) {
            return sourceData;
        }

        const ratio = sourceSampleRate / targetSampleRate;
        const newLength = Math.round(sourceData.length / ratio);
        const result = new Float32Array(newLength);

        for (let i = 0; i < newLength; i++) {
            const srcIndex = i * ratio;
            const srcIndexFloor = Math.floor(srcIndex);
            const srcIndexCeil = Math.min(srcIndexFloor + 1, sourceData.length - 1);
            const t = srcIndex - srcIndexFloor;
            result[i] = sourceData[srcIndexFloor] * (1 - t) + sourceData[srcIndexCeil] * t;
        }

        return result;
    },

    async start() {
        if (this.isActive) return;

        try {
            // 모델 로드 (최초 1회)
            if (!this.isModelLoaded) {
                await this.loadWhisperModel();
            }

            // 비디오 오디오 캡처
            this.showNotification('오디오 캡처 중...', 'info');
            const success = await this.captureVideoAudio();
            if (!success) return;

            // 녹음 및 인식 루프 시작
            this.isActive = true;
            this.startRecordingLoop();

            this.captionContainer.classList.add('active');
            this.updateLangDisplay();
            this.updateStatus('듣는 중...');
            this.showNotification('자막 활성화 (Whisper AI)', 'success');

        } catch (e) {
            console.error('[Captions] Start failed:', e);
            this.showNotification('자막 시작 실패', 'error');
            this.cleanup();
        }
    },

    stop() {
        if (!this.isActive) return;
        this.isActive = false;
        this.cleanup();
        this.captionContainer.classList.remove('active');
        this.clearCaption();
        this.showNotification('자막 비활성화', 'info');
    },

    cleanup() {
        if (this.recordingInterval) {
            clearInterval(this.recordingInterval);
            this.recordingInterval = null;
        }

        if (this.audioRecorder && this.audioRecorder.state !== 'inactive') {
            this.audioRecorder.stop();
        }
        this.audioRecorder = null;

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
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

        const current = this.captionContainer.querySelector('.caption-current');
        if (current) current.textContent = '';
    },

    // 번역 (DeepL 또는 무료 API)
    async translateText(text) {
        try {
            const sourceLang = this.currentLanguage;
            const targetLang = this.targetLanguage;

            // MyMemory Translation API (무료)
            const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.responseStatus === 200 && data.responseData?.translatedText) {
                return data.responseData.translatedText;
            }

            return text;

        } catch (e) {
            console.error('[Captions] Translation error:', e);
            return text;
        }
    },

    setLanguage(langCode) {
        this.currentLanguage = langCode;
        this.updateLangDisplay();
        this.saveSettings();

        if (this.isActive) {
            this.stop();
            setTimeout(() => this.start(), 100);
        }
    },

    setTargetLanguage(langCode) {
        this.targetLanguage = langCode;
        this.saveSettings();
        this.showNotification(`번역 언어: ${this.languages[langCode]?.name || langCode}`, 'info');
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
            langEl.textContent = lang ? `🤖 ${lang.flag} ${lang.name}` : this.currentLanguage;
        }
    },

    updateStatus(status) {
        const statusEl = this.captionContainer.querySelector('.caption-listening');
        if (statusEl) {
            if (status === '듣는 중...') {
                statusEl.innerHTML = '<span class="pulse-dot"></span> ' + status;
            } else {
                statusEl.textContent = status;
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
                this.currentLanguage = settings.currentLanguage || 'ko';
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
        }, 3000);
    }
};
