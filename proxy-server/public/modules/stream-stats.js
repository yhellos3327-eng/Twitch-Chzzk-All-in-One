// Stream Stats Module - 업타임, 비트레이트, FPS, 버퍼 등 통계
// HLS.js 기반 통계 수집

export const StreamStats = {
    hls: null,
    video: null,
    statsPanel: null,
    updateInterval: null,
    isVisible: false,

    // 업타임 관련
    streamStartTime: null,
    uptimeInterval: null,

    // 통계 데이터
    stats: {
        bitrate: 0,
        bandwidth: 0,
        fps: 0,
        droppedFrames: 0,
        totalFrames: 0,
        bufferLength: 0,
        latency: 0,
        resolution: '',
        codec: '',
        level: 0
    },

    init(hlsInstance, videoElement) {
        this.hls = hlsInstance;
        this.video = videoElement;

        this.createStatsPanel();
        this.createUptimeDisplay();
        this.setupHlsEvents();

        console.log('[StreamStats] Initialized');
    },

    createStatsPanel() {
        this.statsPanel = document.createElement('div');
        this.statsPanel.id = 'stats-panel';
        this.statsPanel.className = 'stats-panel';
        this.statsPanel.innerHTML = `
            <div class="stats-header">
                <span>📊 스트림 통계</span>
                <button class="stats-close" title="닫기">×</button>
            </div>
            <div class="stats-content">
                <div class="stat-row">
                    <span class="stat-label">해상도</span>
                    <span class="stat-value" id="stat-resolution">-</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">비트레이트</span>
                    <span class="stat-value" id="stat-bitrate">-</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">대역폭</span>
                    <span class="stat-value" id="stat-bandwidth">-</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">FPS</span>
                    <span class="stat-value" id="stat-fps">-</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">버퍼</span>
                    <span class="stat-value" id="stat-buffer">-</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">지연 시간</span>
                    <span class="stat-value" id="stat-latency">-</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">드롭 프레임</span>
                    <span class="stat-value" id="stat-dropped">-</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">코덱</span>
                    <span class="stat-value" id="stat-codec">-</span>
                </div>
            </div>
        `;

        document.getElementById('player-container')?.appendChild(this.statsPanel);

        // 닫기 버튼
        this.statsPanel.querySelector('.stats-close').addEventListener('click', () => {
            this.hide();
        });
    },

    createUptimeDisplay() {
        const uptimeEl = document.createElement('div');
        uptimeEl.id = 'uptime-display';
        uptimeEl.className = 'uptime-display';
        uptimeEl.innerHTML = `
            <span class="uptime-icon">⏱️</span>
            <span class="uptime-value">00:00:00</span>
        `;

        // 상단 바에 추가
        const topBar = document.querySelector('.controls-right');
        if (topBar) {
            topBar.insertBefore(uptimeEl, topBar.firstChild);
        }
    },

    setupHlsEvents() {
        if (!this.hls) return;

        // 레벨 로드시 해상도/비트레이트 정보
        this.hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
            if (data.details) {
                this.stats.targetDuration = data.details.targetduration;
            }
        });

        // 레벨 전환시
        this.hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
            const level = this.hls.levels[data.level];
            if (level) {
                this.stats.resolution = `${level.width}x${level.height}`;
                this.stats.bitrate = level.bitrate;
                this.stats.codec = level.videoCodec || level.codecSet || '-';
            }
        });

        // Frag 로딩 완료시 대역폭 측정
        this.hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
            if (data.frag && data.stats) {
                const loadTime = data.stats.loading.end - data.stats.loading.start;
                const size = data.stats.total;
                if (loadTime > 0) {
                    this.stats.bandwidth = Math.round((size * 8) / (loadTime / 1000));
                }
            }
        });
    },

    setStreamStartTime(startedAt) {
        if (startedAt) {
            this.streamStartTime = new Date(startedAt);
            this.startUptimeCounter();
        }
    },

    startUptimeCounter() {
        if (this.uptimeInterval) {
            clearInterval(this.uptimeInterval);
        }

        this.updateUptime();
        this.uptimeInterval = setInterval(() => this.updateUptime(), 1000);
    },

    updateUptime() {
        if (!this.streamStartTime) return;

        const now = new Date();
        const diff = now - this.streamStartTime;

        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);

        const uptimeStr = [
            hours.toString().padStart(2, '0'),
            minutes.toString().padStart(2, '0'),
            seconds.toString().padStart(2, '0')
        ].join(':');

        const uptimeEl = document.querySelector('.uptime-value');
        if (uptimeEl) {
            uptimeEl.textContent = uptimeStr;
        }
    },

    show() {
        if (!this.statsPanel) return;

        this.isVisible = true;
        this.statsPanel.classList.add('visible');

        // 업데이트 시작
        this.updateInterval = setInterval(() => this.updateStats(), 1000);
        this.updateStats();
    },

    hide() {
        if (!this.statsPanel) return;

        this.isVisible = false;
        this.statsPanel.classList.remove('visible');

        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    },

    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    },

    updateStats() {
        if (!this.video) return;

        // FPS 계산 (VideoPlaybackQuality API)
        if (this.video.getVideoPlaybackQuality) {
            const quality = this.video.getVideoPlaybackQuality();
            this.stats.droppedFrames = quality.droppedVideoFrames;
            this.stats.totalFrames = quality.totalVideoFrames;

            // FPS 추정 (대략적)
            if (quality.totalVideoFrames > 0) {
                const elapsed = this.video.currentTime;
                if (elapsed > 0) {
                    this.stats.fps = Math.round(quality.totalVideoFrames / elapsed);
                }
            }
        }

        // 버퍼 길이
        if (this.video.buffered.length > 0) {
            const bufferedEnd = this.video.buffered.end(this.video.buffered.length - 1);
            this.stats.bufferLength = Math.max(0, bufferedEnd - this.video.currentTime);
        }

        // HLS 레벨 정보
        if (this.hls && this.hls.currentLevel >= 0) {
            const level = this.hls.levels[this.hls.currentLevel];
            if (level) {
                this.stats.resolution = `${level.width || this.video.videoWidth}x${level.height || this.video.videoHeight}`;
                this.stats.bitrate = level.bitrate || 0;
                this.stats.codec = level.videoCodec || '-';
            }
        }

        // 지연 시간 (라이브 엣지와의 차이)
        if (this.hls && this.video.buffered.length > 0) {
            const liveEdge = this.video.buffered.end(this.video.buffered.length - 1);
            this.stats.latency = Math.max(0, liveEdge - this.video.currentTime);
        }

        this.renderStats();
    },

    renderStats() {
        const formatBitrate = (bps) => {
            if (!bps) return '-';
            if (bps >= 1000000) return (bps / 1000000).toFixed(2) + ' Mbps';
            if (bps >= 1000) return (bps / 1000).toFixed(0) + ' Kbps';
            return bps + ' bps';
        };

        const formatBuffer = (sec) => {
            if (sec === undefined || sec === null) return '-';
            return sec.toFixed(1) + 's';
        };

        document.getElementById('stat-resolution').textContent = this.stats.resolution || '-';
        document.getElementById('stat-bitrate').textContent = formatBitrate(this.stats.bitrate);
        document.getElementById('stat-bandwidth').textContent = formatBitrate(this.stats.bandwidth);
        document.getElementById('stat-fps').textContent = this.stats.fps ? this.stats.fps + ' fps' : '-';
        document.getElementById('stat-buffer').textContent = formatBuffer(this.stats.bufferLength);
        document.getElementById('stat-latency').textContent = formatBuffer(this.stats.latency);
        document.getElementById('stat-dropped').textContent =
            `${this.stats.droppedFrames} / ${this.stats.totalFrames}`;
        document.getElementById('stat-codec').textContent = this.stats.codec || '-';
    },

    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        if (this.uptimeInterval) {
            clearInterval(this.uptimeInterval);
        }
        if (this.statsPanel) {
            this.statsPanel.remove();
        }
    }
};
