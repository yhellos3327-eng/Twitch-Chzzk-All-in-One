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

    // 음소거 상태 (자막 시작 전 볼륨)
    previousVolume: 1.0,
    isMutedByCaption: false,

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
            const statusMsg = this.translateToKorean ? '듣는 중... (자동 감지)' : '듣는 중...';
            this.updateStatus(statusMsg);
            console.log('[Captions] Started - language detection:', this.translateToKorean);

            // 3. 비디오 음소거 (오디오 중첩 방지)
            this.muteVideo();

        } catch (e) {
            console.error('[Captions] Start failed:', e);
            this.isConnecting = false;
            this.updateStatus('시작 실패');
            this.showNotification(`자막 시작 실패: ${e.message}`, 'error');
            this.cleanup();
            this.captionContainer?.classList.remove('active');
        }
    },

    // 자막 시작 시 비디오 음소거 (오디오 중첩 방지)
    muteVideo() {
        if (this.isMutedByCaption) return;

        if (this.useSharedContext) {
            // 공유 컨텍스트: AudioEnhancer의 gainNode 제어
            if (AudioEnhancer.gainNode) {
                this.previousVolume = AudioEnhancer.gainNode.gain.value;
                AudioEnhancer.gainNode.gain.value = 0;
                this.isMutedByCaption = true;
                console.log('[Captions] Muted via AudioEnhancer gainNode');
            }
        } else if (this.gainNode) {
            // 독립 컨텍스트: 자체 gainNode 제어
            this.previousVolume = this.gainNode.gain.value;
            this.gainNode.gain.value = 0;
            this.isMutedByCaption = true;
            console.log('[Captions] Muted via own gainNode');
        }
    },

    // 자막 종료 시 비디오 음소거 해제
    unmuteVideo() {
        if (!this.isMutedByCaption) return;

        if (this.useSharedContext) {
            // 공유 컨텍스트: AudioEnhancer의 gainNode 복원
            if (AudioEnhancer.gainNode) {
                AudioEnhancer.gainNode.gain.value = this.previousVolume || 1.0;
                console.log('[Captions] Unmuted via AudioEnhancer gainNode');
            }
        } else if (this.gainNode) {
            // 독립 컨텍스트: 자체 gainNode 복원
            this.gainNode.gain.value = this.previousVolume || 1.0;
            console.log('[Captions] Unmuted via own gainNode');
        }

        this.isMutedByCaption = false;
    },

    async setupAudioCapture() {
        // AudioEnhancer가 이미 AudioContext를 생성했는지 확인
        // 같은 비디오에 MediaElementSource는 한 번만 생성 가능
        const hasExistingContext = AudioEnhancer.context && AudioEnhancer.sourceConnected;

        if (hasExistingContext) {
            // AudioEnhancer의 context와 streamDestination 사용
            console.log('[Captions] Using existing AudioEnhancer context');

            this.audioContext = AudioEnhancer.context;
            this.useSharedContext = true;

            // AudioEnhancer에서 스트림 가져오기
            if (!AudioEnhancer.streamDestination) {
                // StreamDestination 생성
                AudioEnhancer.streamDestination = this.audioContext.createMediaStreamDestination();
                // Source를 streamDestination에도 연결
                AudioEnhancer.source.connect(AudioEnhancer.streamDestination);
            }

            const stream = AudioEnhancer.streamDestination.stream;
            this.sourceNode = this.audioContext.createMediaStreamSource(stream);

        } else {
            // 새 AudioContext 생성
            const AC = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AC();
            this.useSharedContext = false;

            // Context가 suspended 상태면 resume
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            // MediaElementSource 생성
            try {
                this.sourceNode = this.audioContext.createMediaElementSource(this.videoElement);
                console.log('[Captions] Created new MediaElementSource');
            } catch (e) {
                if (e.name === 'InvalidStateError') {
                    throw new Error('비디오가 다른 오디오 처리에 연결되어 있습니다. 페이지를 새로고침해주세요.');
                }
                throw e;
            }
        }

        // ScriptProcessor로 오디오 데이터 추출 (16kHz로 다운샘플링 필요)
        const bufferSize = 4096;
        this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

        // 샘플레이트 변환 비율
        const sourceSampleRate = this.audioContext.sampleRate;
        const targetSampleRate = 16000;
        const ratio = sourceSampleRate / targetSampleRate;

        this.processorNode.onaudioprocess = (e) => {
            if (!this.isActive || !this.sttSocket || this.sttSocket.readyState !== WebSocket.OPEN) {
                return;
            }

            const inputData = e.inputBuffer.getChannelData(0);

            // 다운샘플링 (예: 48kHz -> 16kHz)
            let resampledData;
            if (ratio > 1) {
                const newLength = Math.floor(inputData.length / ratio);
                resampledData = new Float32Array(newLength);
                for (let i = 0; i < newLength; i++) {
                    resampledData[i] = inputData[Math.floor(i * ratio)];
                }
            } else {
                resampledData = inputData;
            }

            // Float32 -> Int16 PCM 변환
            const pcmData = this.float32ToInt16(resampledData);

            // WebSocket으로 전송
            this.sttSocket.send(pcmData.buffer);
        };

        if (hasExistingContext) {
            // 공유 컨텍스트 사용 시: Processor만 연결 (AudioEnhancer가 오디오 출력 담당)
            this.sourceNode.connect(this.processorNode);
            // Processor는 destination에 연결하지 않음 (onaudioprocess 호출을 위해 dummy 연결)
            const silentGain = this.audioContext.createGain();
            silentGain.gain.value = 0;
            this.processorNode.connect(silentGain);
            silentGain.connect(this.audioContext.destination);
            console.log('[Captions] Audio capture via shared context (no duplication)');

        } else {
            // 새 컨텍스트 사용 시: GainNode로 오디오 출력
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 1.0;

            // Source -> GainNode -> Destination
            this.sourceNode.connect(this.gainNode);
            this.gainNode.connect(this.audioContext.destination);

            // Source -> Processor (STT용)
            this.sourceNode.connect(this.processorNode);
            const silentGain = this.audioContext.createGain();
            silentGain.gain.value = 0;
            this.processorNode.connect(silentGain);
            silentGain.connect(this.audioContext.destination);

            console.log('[Captions] Audio capture via new context');
        }
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

            // 다국어 자동 감지
            if (this.translateToKorean) {
                params.set('detect_language', 'true');
            } else {
                params.set('language', this.sourceLanguage === 'multi' ? 'ko' : this.sourceLanguage);
            }

            // 프록시 서버를 통해 Deepgram에 연결
            // (브라우저 WebSocket은 Authorization 헤더를 지원하지 않음)
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const proxyUrl = `${wsProtocol}//${window.location.host}/deepgram?apiKey=${encodeURIComponent(this.apiKey)}&params=${encodeURIComponent(params.toString())}`;

            console.log('[Captions] Connecting via proxy...');

            this.sttSocket = new WebSocket(proxyUrl);

            let isResolved = false;

            this.sttSocket.onopen = () => {
                console.log('[Captions] WebSocket opened, waiting for Deepgram connection...');
            };

            this.sttSocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    // 프록시 서버의 연결 확인 메시지
                    if (data.type === 'connected') {
                        console.log('[Captions] Deepgram connected via proxy');
                        if (!isResolved) {
                            isResolved = true;
                            resolve();
                        }
                        return;
                    }

                    // 프록시 서버의 에러 메시지
                    if (data.type === 'error') {
                        console.error('[Captions] Deepgram error:', data.error);
                        if (!isResolved) {
                            isResolved = true;
                            reject(new Error(data.error));
                        }
                        return;
                    }

                    // Deepgram STT 결과
                    this.handleSTTResult(data);
                } catch (e) {
                    // JSON 파싱 실패 - 바이너리 데이터일 수 있음
                    console.warn('[Captions] Non-JSON message received');
                }
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
                if (!isResolved) {
                    isResolved = true;
                    if (this.sttSocket) {
                        this.sttSocket.close();
                    }
                    reject(new Error('연결 타임아웃'));
                }
            }, 15000);
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

        // 비디오 음소거 해제
        this.unmuteVideo();

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

        // GainNode 연결 해제 (공유 컨텍스트가 아닐 때만)
        if (this.gainNode && !this.useSharedContext) {
            try { this.gainNode.disconnect(); } catch (e) { }
            this.gainNode = null;
        }

        // Source 연결 해제 (공유 컨텍스트일 때는 스트림 소스만)
        if (this.sourceNode) {
            try { this.sourceNode.disconnect(); } catch (e) { }
            this.sourceNode = null;
        }

        // AudioContext 닫기 (공유 컨텍스트가 아닐 때만)
        if (this.audioContext && !this.useSharedContext) {
            try { this.audioContext.close(); } catch (e) { }
        }
        this.audioContext = null;
        this.useSharedContext = false;
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
                <p>영상 음성을 실시간으로 인식하여 자막으로 표시합니다.</p>
                <p class="caption-api-hint">
                    <a href="https://deepgram.com" target="_blank">deepgram.com</a>에서
                    무료 API 키를 발급받으세요. ($200 크레딧 제공)
                </p>
                <input type="password" id="caption-api-input" placeholder="Deepgram API 키" value="${savedKey}" />

                <div class="caption-option">
                    <label>
                        <input type="checkbox" id="caption-translate-toggle" ${this.translateToKorean ? 'checked' : ''} />
                        <span>다국어 자동 감지 (영어/일본어/한국어 등)</span>
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
