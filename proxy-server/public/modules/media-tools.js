// Media Tools Module - 스크린샷, 클립 녹화, 타임머신 기능

export const MediaTools = {
    video: null,
    channelName: '',

    // 녹화 관련
    mediaRecorder: null,
    recordedChunks: [],
    isRecording: false,
    recordingStartTime: null,
    maxRecordingDuration: 120000, // 최대 2분
    displayStream: null, // 탭 오디오 캡처용

    // 타임머신 (DVR) 관련
    seekBuffer: 30, // 30초 뒤로 가기 가능

    init(videoElement, channel) {
        this.video = videoElement;
        this.channelName = channel;
        this.setupKeyboardShortcuts();
        console.log('[MediaTools] Initialized');
    },

    // ==================== 스크린샷 ====================
    takeScreenshot() {
        if (!this.video) {
            console.error('[Screenshot] Video element not found');
            return;
        }

        try {
            const canvas = document.createElement('canvas');
            canvas.width = this.video.videoWidth;
            canvas.height = this.video.videoHeight;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);

            // 타임스탬프 추가 (선택사항)
            const timestamp = new Date().toLocaleString('ko-KR');
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(10, canvas.height - 35, 200, 25);
            ctx.fillStyle = 'white';
            ctx.font = '14px Inter, sans-serif';
            ctx.fillText(`${this.channelName} - ${timestamp}`, 15, canvas.height - 17);

            // 다운로드
            canvas.toBlob((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${this.channelName}_${this.getTimestampFilename()}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                this.showNotification('스크린샷 저장됨', 'success');
            }, 'image/png');

        } catch (e) {
            console.error('[Screenshot] Error:', e);
            this.showNotification('스크린샷 실패', 'error');
        }
    },

    // ==================== 클립 녹화 (오디오 포함) ====================
    async startRecording() {
        if (this.isRecording) {
            console.log('[Clip] Already recording');
            return;
        }

        if (!this.video) {
            console.error('[Clip] Video element not found');
            return;
        }

        try {
            // getDisplayMedia로 탭 오디오 캡처
            // preferCurrentTab: true로 현재 탭만 선택
            this.displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    displaySurface: 'browser',
                    width: { ideal: this.video.videoWidth || 1920 },
                    height: { ideal: this.video.videoHeight || 1080 },
                    frameRate: { ideal: 30 }
                },
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    sampleRate: 48000
                },
                preferCurrentTab: true,
                selfBrowserSurface: 'include',
                systemAudio: 'include'
            });

            // 스트림 종료 감지 (사용자가 공유 중지 클릭 시)
            this.displayStream.getVideoTracks()[0].onended = () => {
                if (this.isRecording) {
                    this.stopRecording();
                }
            };

            // 오디오 트랙 확인
            const audioTracks = this.displayStream.getAudioTracks();
            const hasAudio = audioTracks.length > 0;
            console.log('[Clip] Audio tracks:', audioTracks.length, hasAudio ? audioTracks[0].label : 'none');

            // MediaRecorder 설정
            const options = {
                mimeType: this.getSupportedMimeType(),
                videoBitsPerSecond: 8000000, // 8 Mbps
                audioBitsPerSecond: 128000   // 128 kbps
            };

            this.mediaRecorder = new MediaRecorder(this.displayStream, options);
            this.recordedChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                this.saveRecording();
                this.cleanupDisplayStream();
            };

            this.mediaRecorder.onerror = (event) => {
                console.error('[Clip] Recording error:', event.error);
                this.showNotification('녹화 오류 발생', 'error');
                this.isRecording = false;
                this.cleanupDisplayStream();
            };

            // 녹화 시작
            this.isRecording = true;
            this.recordingStartTime = Date.now();
            this.mediaRecorder.start(1000); // 1초마다 데이터 수집

            const audioStatus = hasAudio ? '오디오 포함' : '오디오 없음';
            this.showNotification(`녹화 시작 (최대 2분, ${audioStatus})`, 'recording');
            this.updateRecordingUI(true);

            // 최대 녹화 시간 제한
            setTimeout(() => {
                if (this.isRecording) {
                    this.stopRecording();
                }
            }, this.maxRecordingDuration);

        } catch (e) {
            console.error('[Clip] Start recording error:', e);

            if (e.name === 'NotAllowedError') {
                this.showNotification('화면 공유가 취소되었습니다', 'error');
            } else {
                this.showNotification('녹화 시작 실패', 'error');
            }

            this.isRecording = false;
            this.cleanupDisplayStream();
        }
    },

    cleanupDisplayStream() {
        if (this.displayStream) {
            this.displayStream.getTracks().forEach(track => track.stop());
            this.displayStream = null;
        }
    },

    // 레거시: 간단한 캔버스 기반 녹화 (비디오만, 오디오 없음)
    async startSimpleRecording() {
        if (this.isRecording) {
            console.log('[Clip] Already recording');
            return;
        }

        if (!this.video) {
            console.error('[Clip] Video element not found');
            return;
        }

        try {
            const canvas = document.createElement('canvas');
            canvas.width = this.video.videoWidth || 1920;
            canvas.height = this.video.videoHeight || 1080;
            const ctx = canvas.getContext('2d');

            const stream = canvas.captureStream(30);

            const options = {
                mimeType: this.getSupportedMimeType(),
                videoBitsPerSecond: 8000000
            };

            this.mediaRecorder = new MediaRecorder(stream, options);
            this.recordedChunks = [];
            this.recordingCanvas = canvas;
            this.recordingCtx = ctx;

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                this.saveRecording();
                this.recordingCanvas = null;
                this.recordingCtx = null;
            };

            this.mediaRecorder.onerror = (event) => {
                console.error('[Clip] Recording error:', event.error);
                this.showNotification('녹화 오류 발생', 'error');
                this.isRecording = false;
            };

            this.isRecording = true;
            this.recordingStartTime = Date.now();
            this.mediaRecorder.start(1000);

            const drawFrame = () => {
                if (this.isRecording && this.recordingCtx && this.video) {
                    this.recordingCtx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
                    requestAnimationFrame(drawFrame);
                }
            };
            drawFrame();

            this.showNotification('녹화 시작 (비디오만)', 'recording');
            this.updateRecordingUI(true);

            setTimeout(() => {
                if (this.isRecording) {
                    this.stopRecording();
                }
            }, this.maxRecordingDuration);

        } catch (e) {
            console.error('[Clip] Start simple recording error:', e);
            this.showNotification('녹화 시작 실패', 'error');
            this.isRecording = false;
        }
    },

    stopRecording() {
        if (!this.isRecording || !this.mediaRecorder) {
            return;
        }

        this.isRecording = false;
        this.mediaRecorder.stop();
        this.updateRecordingUI(false);

        const duration = Math.round((Date.now() - this.recordingStartTime) / 1000);
        this.showNotification(`녹화 완료 (${duration}초)`, 'success');
    },

    saveRecording() {
        if (this.recordedChunks.length === 0) {
            console.warn('[Clip] No recorded data');
            return;
        }

        const blob = new Blob(this.recordedChunks, {
            type: this.getSupportedMimeType()
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.channelName}_clip_${this.getTimestampFilename()}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.recordedChunks = [];
    },

    getSupportedMimeType() {
        const types = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
            'video/mp4'
        ];

        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }

        return 'video/webm';
    },

    // ==================== 타임머신 (DVR) ====================
    seekBackward(seconds = 10) {
        if (!this.video) return;

        const newTime = Math.max(0, this.video.currentTime - seconds);
        this.video.currentTime = newTime;
        this.showNotification(`-${seconds}초`, 'info');
    },

    seekForward(seconds = 10) {
        if (!this.video) return;

        // 라이브 스트림에서는 버퍼 끝으로 이동
        const buffered = this.video.buffered;
        if (buffered.length > 0) {
            const bufferEnd = buffered.end(buffered.length - 1);
            const newTime = Math.min(bufferEnd, this.video.currentTime + seconds);
            this.video.currentTime = newTime;
            this.showNotification(`+${seconds}초`, 'info');
        }
    },

    goLive() {
        if (!this.video) return;

        const buffered = this.video.buffered;
        if (buffered.length > 0) {
            this.video.currentTime = buffered.end(buffered.length - 1);
            this.showNotification('라이브로 이동', 'info');
        }
    },

    getTimeBehindLive() {
        if (!this.video) return 0;

        const buffered = this.video.buffered;
        if (buffered.length > 0) {
            return Math.round(buffered.end(buffered.length - 1) - this.video.currentTime);
        }
        return 0;
    },

    // ==================== UI 헬퍼 ====================
    showNotification(message, type = 'info') {
        // 기존 알림 제거
        const existing = document.querySelector('.media-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = `media-notification media-notification-${type}`;
        notification.textContent = message;

        document.body.appendChild(notification);

        // 애니메이션
        requestAnimationFrame(() => {
            notification.classList.add('show');
        });

        // 자동 제거
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 2000);
    },

    updateRecordingUI(isRecording) {
        const recordBtn = document.getElementById('record-btn');
        const recordIndicator = document.getElementById('record-indicator');

        if (recordBtn) {
            recordBtn.classList.toggle('recording', isRecording);
        }

        if (recordIndicator) {
            recordIndicator.style.display = isRecording ? 'flex' : 'none';
        }

        // 녹화 시간 업데이트
        if (isRecording) {
            this.updateRecordingTime();
        }
    },

    updateRecordingTime() {
        if (!this.isRecording) return;

        const indicator = document.getElementById('record-time');
        if (indicator && this.recordingStartTime) {
            const elapsed = Math.round((Date.now() - this.recordingStartTime) / 1000);
            const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const secs = (elapsed % 60).toString().padStart(2, '0');
            indicator.textContent = `${mins}:${secs}`;
        }

        requestAnimationFrame(() => this.updateRecordingTime());
    },

    getTimestampFilename() {
        const now = new Date();
        return now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    },

    // ==================== 키보드 단축키 ====================
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // 입력 필드에서는 무시
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch (e.key.toLowerCase()) {
                case 's':
                    if (e.shiftKey) {
                        e.preventDefault();
                        this.takeScreenshot();
                    }
                    break;

                case 'r':
                    if (e.shiftKey) {
                        e.preventDefault();
                        if (this.isRecording) {
                            this.stopRecording();
                        } else {
                            this.startRecording();
                        }
                    }
                    break;

                case 'j':
                    e.preventDefault();
                    this.seekBackward(10);
                    break;

                case 'l':
                    e.preventDefault();
                    this.seekForward(10);
                    break;

                case 'arrowleft':
                    if (e.shiftKey) {
                        e.preventDefault();
                        this.seekBackward(30);
                    }
                    break;

                case 'arrowright':
                    if (e.shiftKey) {
                        e.preventDefault();
                        this.seekForward(30);
                    }
                    break;

                case 'home':
                    e.preventDefault();
                    this.goLive();
                    break;
            }
        });
    }
};
