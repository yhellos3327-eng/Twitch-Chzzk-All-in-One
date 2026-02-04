// Stream Bypass - Player Page Script (Proxy Version)

(function () {
    'use strict';

    // 프록시 서버 URL (현재 호스트 사용)
    const PROXY_URL = window.location.origin;

    let hls = null;
    let video = null;
    let currentChannel = null;
    let qualities = [];
    let currentQualityIndex = 0;

    // URL에서 채널명 추출
    function getChannelFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('channel');
    }

    // 스트림 정보 가져오기 (프록시 API 사용)
    async function getStreamInfo(channel) {
        console.log('[Player] Getting stream info for:', channel);

        const response = await fetch(`${PROXY_URL}/stream/${channel}`);

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to get stream info');
        }

        const data = await response.json();
        console.log('[Player] Stream info received:', data.qualities?.length, 'qualities');

        return data;
    }

    // UI 요소들
    const elements = {
        video: () => document.getElementById('video-player'),
        channelName: () => document.getElementById('channel-name'),
        liveBadge: () => document.getElementById('live-badge'),
        loadingOverlay: () => document.getElementById('loading-overlay'),
        errorOverlay: () => document.getElementById('error-overlay'),
        errorMessage: () => document.getElementById('error-message'),
        retryBtn: () => document.getElementById('retry-btn'),
        playPauseBtn: () => document.getElementById('play-pause-btn'),
        muteBtn: () => document.getElementById('mute-btn'),
        volumeSlider: () => document.getElementById('volume-slider'),
        qualityBtn: () => document.getElementById('quality-btn'),
        qualityMenu: () => document.getElementById('quality-menu'),
        currentQuality: () => document.getElementById('current-quality'),
        fullscreenBtn: () => document.getElementById('fullscreen-btn'),
        qualityBadge: () => document.getElementById('quality-badge'),
        pipBtn: () => document.getElementById('pip-btn'),
        openTwitchBtn: () => document.getElementById('open-twitch'),
        toggleChatBtn: () => document.getElementById('toggle-chat'),
        refreshChatBtn: () => document.getElementById('refresh-chat'),
        popoutChatBtn: () => document.getElementById('popout-chat'),
        sidebar: () => document.getElementById('sidebar'),
        app: () => document.querySelector('.app'),
        chatIframe: () => document.getElementById('chat-iframe'),
        chatContainer: () => document.getElementById('chat-container'),
    };

    // 로딩 표시
    function showLoading(message = 'Loading stream...') {
        elements.loadingOverlay().style.display = 'flex';
        elements.loadingOverlay().querySelector('span').textContent = message;
        elements.errorOverlay().style.display = 'none';
    }

    // 에러 표시
    function showError(message) {
        elements.loadingOverlay().style.display = 'none';
        elements.errorOverlay().style.display = 'flex';
        elements.errorMessage().textContent = message;
    }

    // 로딩/에러 숨기기
    function hideOverlays() {
        elements.loadingOverlay().style.display = 'none';
        elements.errorOverlay().style.display = 'none';
    }

    // 화질 메뉴 업데이트
    function updateQualityMenu() {
        const menu = elements.qualityMenu();
        menu.innerHTML = qualities.map((q, i) => {
            const isAudioOnly = q.name === 'audio_only';
            const separator = isAudioOnly && i > 0 ? '<div class="menu-separator"></div>' : '';

            // 표시 이름 정리
            let displayName = q.name;
            if (displayName.includes('(source)')) displayName = displayName.replace('(source)', 'Source');
            if (displayName === 'audio_only') displayName = 'Audio Only';

            return `
            ${separator}
            <div class="quality-item ${i === currentQualityIndex ? 'active' : ''}" data-index="${i}">
                ${displayName} 
                ${q.resolution && !isAudioOnly ? `<span style="color:#888; font-size:12px; margin-left:8px;">${q.resolution.split('x')[1]}p</span>` : ''}
            </div>
            `;
        }).join('');

        menu.querySelectorAll('.quality-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                changeQuality(index);
                menu.classList.remove('active');
            });
        });
    }

    // 화질 변경
    function changeQuality(index) {
        if (index < 0 || index >= qualities.length) return;

        currentQualityIndex = index;
        const quality = qualities[index];

        console.log('[Player] Changing quality to:', quality.name);

        const wasPlaying = !video.paused;

        if (hls) {
            hls.destroy();
        }

        hls = new Hls({
            debug: false,
            enableWorker: true,
            lowLatencyMode: true,
        });

        setupHlsEvents(hls);

        hls.loadSource(quality.url);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (wasPlaying) {
                video.play();
            }
        });

        elements.currentQuality().textContent = quality.name;
        updateQualityMenu();

        const badge = elements.qualityBadge();
        if (quality.name.includes('1080') || quality.resolution?.includes('1920')) {
            badge.textContent = '1080p';
            badge.style.display = 'block';
        } else if (quality.name.includes('720')) {
            badge.textContent = '720p';
            badge.style.display = 'block';
        } else {
            badge.textContent = quality.name;
        }
    }

    // HLS 이벤트 설정
    function setupHlsEvents(hlsInstance) {
        hlsInstance.on(Hls.Events.ERROR, (event, data) => {
            console.error('[Player] HLS error:', data);

            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.log('[Player] Network error, trying to recover...');
                        hlsInstance.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.log('[Player] Media error, trying to recover...');
                        hlsInstance.recoverMediaError();
                        break;
                    default:
                        showError('Fatal playback error. Try refreshing.');
                        break;
                }
            }
        });
    }

    // ========== 채팅 iframe 설정 ==========

    // Twitch 채팅 iframe 로드
    function loadChatIframe(channel, attempts = 0) {
        if (attempts > 10) {
            console.error('[Chat] Failed to load chat iframe after 10 attempts');
            return;
        }

        let chatIframe = document.getElementById('chat-iframe');

        // 요소가 없으면 동적으로 생성 시도
        if (!chatIframe) {
            const container = document.getElementById('chat-container');
            if (container) {
                console.log('[Chat] Creating chat iframe dynamically');
                chatIframe = document.createElement('iframe');
                chatIframe.id = 'chat-iframe';
                chatIframe.className = 'chat-iframe';
                chatIframe.setAttribute('frameborder', '0');
                chatIframe.setAttribute('scrolling', 'yes');
                chatIframe.setAttribute('allowtransparency', 'true');

                container.innerHTML = '';
                container.appendChild(chatIframe);
            } else {
                console.warn(`[Chat] Chat container not found, retrying (${attempts + 1}/10)...`);
                setTimeout(() => loadChatIframe(channel, attempts + 1), 1000);
                return;
            }
        }

        // 이미 로드된 경우 스킵 (채널이 같을 때)
        if (chatIframe.getAttribute('data-channel') === channel) {
            return;
        }

        // Twitch 채팅 임베드 URL (parent 필수)
        const hostname = window.location.hostname;
        const chatUrl = `https://www.twitch.tv/embed/${channel}/chat?darkpopout&parent=${hostname}`;

        console.log('[Chat] Loading chat iframe:', chatUrl);

        chatIframe.src = chatUrl;
        chatIframe.setAttribute('data-channel', channel);
    }

    // 채팅 새로고침
    function refreshChat() {
        const chatIframe = elements.chatIframe();

        if (chatIframe && currentChannel) {
            console.log('[Chat] Refreshing chat');
            const hostname = window.location.hostname;
            const chatUrl = `https://www.twitch.tv/embed/${currentChannel}/chat?darkpopout&parent=${hostname}`;
            chatIframe.src = chatUrl;
        }
    }

    // 채팅 팝업 열기
    function openChatPopup() {
        if (!currentChannel) return;
        const chatUrl = `https://www.twitch.tv/popout/${currentChannel}/chat?darkpopout`;
        window.open(chatUrl, 'twitch-chat', 'width=400,height=600,resizable=yes,scrollbars=yes');
    }

    // 스트림 시작
    async function startStream(channel) {
        showLoading('Connecting to stream...');

        try {
            console.log('[Player] Starting stream for:', channel);

            const streamInfo = await getStreamInfo(channel);

            if (!streamInfo.qualities || streamInfo.qualities.length === 0) {
                throw new Error('Stream is offline or no qualities available');
            }

            console.log('[Player] Stream info:', streamInfo);
            qualities = streamInfo.qualities;

            // 화질 정렬: 해상도(resolution) -> 대역폭(bandwidth) 내림차순
            qualities.sort((a, b) => {
                const resA = a.resolution ? parseInt(a.resolution.split('x')[1]) : 0;
                const resB = b.resolution ? parseInt(b.resolution.split('x')[1]) : 0;

                if (resA !== resB) return resB - resA;

                const bwA = a.bandwidth ? parseInt(a.bandwidth) : 0;
                const bwB = b.bandwidth ? parseInt(b.bandwidth) : 0;
                return bwB - bwA;
            });

            console.log('[Player] Best quality selected:', qualities[0].name);

            // UI 업데이트
            elements.channelName().textContent = channel;
            document.title = `${channel} - Stream Bypass`;

            // 채팅 iframe 로드
            loadChatIframe(channel);

            // 1080p 확인
            const has1080p = qualities.some(q => q.name.includes('1080') || q.resolution?.includes('1920'));
            if (has1080p) {
                console.log('[Player] ✓ 1080p quality available!');
            }

            // HLS 플레이어 초기화
            video = elements.video();

            if (!Hls.isSupported()) {
                throw new Error('HLS is not supported in this browser');
            }

            hls = new Hls({
                debug: false,
                enableWorker: true,
                lowLatencyMode: true,
                backBufferLength: 90,
            });

            setupHlsEvents(hls);

            const bestQuality = qualities[0];
            currentQualityIndex = 0;

            hls.loadSource(bestQuality.url);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                console.log('[Player] Manifest parsed, starting playback');
                hideOverlays();

                // 브라우저 정책상 음소거 상태로 자동 재생 시도
                video.muted = true;

                const playPromise = video.play();

                if (playPromise !== undefined) {
                    playPromise
                        .then(() => {
                            console.log('[Player] Autoplay started (muted)');
                            // 자동 재생 성공 시, UI 업데이트
                            updateVolumeUI();
                        })
                        .catch(error => {
                            console.warn('[Player] Autoplay failed:', error);
                            // 실패 시 음소거 해제하고 다시 시도해볼 수도 있지만, 보통 사용자 상호작용 필요
                            showError('Click to play stream');
                            // 클릭 이벤트 한 번으로 재생되도록 오버레이 클릭 리스너 추가
                            const overlay = elements.errorOverlay();
                            overlay.style.cursor = 'pointer';
                            overlay.onclick = () => {
                                video.play();
                                hideOverlays();
                                overlay.onclick = null;
                            };
                        });
                }

                updateQualityMenu();
                elements.currentQuality().textContent = bestQuality.name;

                if (bestQuality.name.includes('1080') || bestQuality.resolution?.includes('1920')) {
                    elements.qualityBadge().textContent = '1080p';
                }
            });

        } catch (error) {
            console.error('[Player] Error:', error);
            showError(error.message);
        }
    }

    // 볼륨 UI 업데이트
    function updateVolumeUI() {
        if (!video) return;
        const muted = video.muted || video.volume === 0;

        // 버튼 아이콘 토글
        const muteBtn = elements.muteBtn();
        if (muteBtn) {
            muteBtn.querySelector('.icon-volume').style.display = muted ? 'none' : 'block';
            muteBtn.querySelector('.icon-muted').style.display = muted ? 'block' : 'none';
        }

        // 슬라이더 업데이트
        const slider = elements.volumeSlider();
        if (slider) {
            slider.value = muted ? 0 : video.volume * 100;
        }
    }

    // 컨트롤 설정
    function setupControls() {
        video = elements.video();

        // 재생/일시정지
        elements.playPauseBtn().addEventListener('click', () => {
            if (video.paused) {
                video.play();
            } else {
                video.pause();
            }
        });

        video.addEventListener('play', () => {
            elements.playPauseBtn().querySelector('.icon-play').style.display = 'none';
            elements.playPauseBtn().querySelector('.icon-pause').style.display = 'block';
        });

        video.addEventListener('pause', () => {
            elements.playPauseBtn().querySelector('.icon-play').style.display = 'block';
            elements.playPauseBtn().querySelector('.icon-pause').style.display = 'none';
        });

        // 음소거
        elements.muteBtn().addEventListener('click', () => {
            video.muted = !video.muted;
            updateVolumeUI();
        });

        video.addEventListener('volumechange', () => {
            updateVolumeUI();
        });

        // 볼륨 슬라이더
        elements.volumeSlider().addEventListener('input', (e) => {
            video.volume = e.target.value / 100;
            if (video.volume > 0) video.muted = false;
            updateVolumeUI();
        });

        // 화질 메뉴
        elements.qualityBtn().addEventListener('click', (e) => {
            e.stopPropagation();
            elements.qualityMenu().classList.toggle('active');
        });

        document.addEventListener('click', () => {
            elements.qualityMenu().classList.remove('active');
        });

        // 전체화면
        elements.fullscreenBtn().addEventListener('click', () => {
            if (document.fullscreenElement) {
                document.exitFullscreen();
                elements.app().classList.remove('fullscreen');
            } else {
                document.documentElement.requestFullscreen();
                elements.app().classList.add('fullscreen');
            }
        });

        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) {
                elements.app().classList.remove('fullscreen');
            }
        });

        // PIP
        elements.pipBtn().addEventListener('click', async () => {
            try {
                if (document.pictureInPictureElement) {
                    await document.exitPictureInPicture();
                } else {
                    await video.requestPictureInPicture();
                }
            } catch (e) {
                console.error('[Player] PIP error:', e);
            }
        });

        // Twitch에서 열기
        elements.openTwitchBtn().addEventListener('click', () => {
            if (currentChannel) {
                window.open(`https://www.twitch.tv/${currentChannel}`, '_blank');
            }
        });

        // 채팅 토글
        elements.toggleChatBtn().addEventListener('click', () => {
            elements.sidebar().classList.toggle('hidden');
            elements.app().classList.toggle('chat-hidden');
        });

        // 채팅 새로고침
        const refreshChatButton = elements.refreshChatBtn();
        if (refreshChatButton) {
            refreshChatButton.addEventListener('click', refreshChat);
        }

        // 채팅 팝업
        const popoutChatButton = elements.popoutChatBtn();
        if (popoutChatButton) {
            popoutChatButton.addEventListener('click', openChatPopup);
        }

        // 재시도
        elements.retryBtn().addEventListener('click', () => {
            if (currentChannel) {
                startStream(currentChannel);
            }
        });

        // 더블클릭 전체화면
        video.addEventListener('dblclick', () => {
            elements.fullscreenBtn().click();
        });

        // 클릭 재생/일시정지
        video.addEventListener('click', () => {
            elements.playPauseBtn().click();
        });

        // 키보드 단축키
        document.addEventListener('keydown', (e) => {
            switch (e.key) {
                case ' ':
                case 'k':
                    e.preventDefault();
                    elements.playPauseBtn().click();
                    break;
                case 'f':
                    elements.fullscreenBtn().click();
                    break;
                case 'm':
                    elements.muteBtn().click();
                    break;
                case 'c':
                    elements.toggleChatBtn().click();
                    break;
                case 'r':
                    refreshChat();
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    video.volume = Math.min(1, video.volume + 0.1);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    video.volume = Math.max(0, video.volume - 0.1);
                    break;
            }
        });
    }

    // ========== 비디오 화질 개선 (Video Enhancement) ==========
    const VideoEnhancer = {
        settings: {
            enabled: false,
            mode: 'default',
            sharpness: 1.0,
            saturation: 1.0,
            contrast: 100,
            brightness: 100
        },

        elements: {
            toggle: null,
            modeSelect: null,
            sharpness: null,
            saturation: null,
            contrast: null,
            brightness: null,
            resetBtn: null,
            matrix: null,
            colorMatrix: null,
            menu: null,
            btn: null,
            settingsMenu: null
        },

        init() {
            // 요소 참조
            this.elements.toggle = document.getElementById('enhancement-toggle');
            this.elements.modeSelect = document.getElementById('filter-mode-select');
            this.elements.sharpness = document.getElementById('sharpness-slider');
            this.elements.saturation = document.getElementById('saturation-slider');
            this.elements.contrast = document.getElementById('contrast-slider');
            this.elements.brightness = document.getElementById('brightness-slider');
            this.elements.resetBtn = document.getElementById('reset-settings-btn');
            this.elements.matrix = document.getElementById('sharpness-matrix');
            this.elements.colorMatrix = document.getElementById('color-matrix');
            this.elements.btn = document.getElementById('settings-btn');
            this.elements.settingsMenu = document.getElementById('settings-menu');

            if (!this.elements.toggle) return; // 요소가 없으면 중단

            // 저장된 설정 로드
            this.loadSettings();

            // 이벤트 리스너 설정
            this.setupListeners();

            // 초기 적용
            this.applyFilters();
        },

        loadSettings() {
            try {
                const saved = localStorage.getItem('videoEnhancementSettings');
                if (saved) {
                    this.settings = { ...this.settings, ...JSON.parse(saved) };
                }
            } catch (e) {
                console.error('[Enhancer] Failed to load settings:', e);
            }

            // UI 업데이트
            this.elements.toggle.checked = this.settings.enabled;
            if (this.elements.modeSelect) this.elements.modeSelect.value = this.settings.mode || 'default';
            this.elements.sharpness.value = this.settings.sharpness;
            this.elements.saturation.value = this.settings.saturation;
            this.elements.contrast.value = this.settings.contrast;
            this.elements.brightness.value = this.settings.brightness;

            this.updateLabels();
        },

        saveSettings() {
            try {
                localStorage.setItem('videoEnhancementSettings', JSON.stringify(this.settings));
            } catch (e) { }
        },

        setupListeners() {
            // 토글
            this.elements.toggle.addEventListener('change', (e) => {
                this.settings.enabled = e.target.checked;
                this.applyFilters();
                this.saveSettings();
            });

            // 모드 선택
            if (this.elements.modeSelect) {
                this.elements.modeSelect.addEventListener('change', (e) => {
                    this.setMode(e.target.value);
                });
            }

            // 슬라이더들
            const sliders = [
                { el: this.elements.sharpness, key: 'sharpness' },
                { el: this.elements.saturation, key: 'saturation' },
                { el: this.elements.contrast, key: 'contrast' },
                { el: this.elements.brightness, key: 'brightness' }
            ];

            sliders.forEach(({ el, key }) => {
                el.addEventListener('input', (e) => {
                    this.settings[key] = parseFloat(e.target.value);
                    this.updateLabels();
                    this.applyFilters();
                    this.saveSettings();
                });
            });

            // 리셋 버튼
            this.elements.resetBtn.addEventListener('click', () => {
                this.resetSettings();
            });

            // 메뉴 토글
            this.elements.btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.elements.settingsMenu.classList.toggle('active');
                // 화질 메뉴 닫기
                elements.qualityMenu().classList.remove('active');
            });

            // 메뉴 닫기 (외부 클릭)
            document.addEventListener('click', (e) => {
                if (!e.target.closest('#settings-menu') && !e.target.closest('#settings-btn')) {
                    this.elements.settingsMenu.classList.remove('active');
                }
            });
        },

        setMode(mode) {
            this.settings.mode = mode;
            if (mode === 'natural') {
                this.settings.saturation = 1.2;
            } else {
                this.settings.saturation = 1.0;
            }

            if (this.elements.saturation) this.elements.saturation.value = this.settings.saturation;
            if (this.elements.modeSelect) this.elements.modeSelect.value = mode;

            this.updateLabels();
            this.applyFilters();
            this.saveSettings();
        },

        updateLabels() {
            document.getElementById('sharpness-value').textContent = this.settings.sharpness.toFixed(1) + 'x';
            document.getElementById('saturation-value').textContent = this.settings.saturation.toFixed(1) + 'x';
            document.getElementById('contrast-value').textContent = this.settings.contrast + '%';
            document.getElementById('brightness-value').textContent = this.settings.brightness + '%';
        },

        resetSettings() {
            this.settings = {
                enabled: false,
                mode: 'default',
                sharpness: 1.0,
                saturation: 1.0,
                contrast: 100,
                brightness: 100
            };
            this.loadSettings(); // UI 반영
            this.applyFilters();
            this.saveSettings();
        },

        applyFilters() {
            if (!video) video = document.getElementById('video-player');
            if (!video) return;

            if (!this.settings.enabled) {
                video.classList.remove('video-enhanced');
                video.style.filter = '';
                return;
            }

            video.classList.add('video-enhanced');

            // 1. 샤프닝 (SVG feConvolveMatrix) update
            // Kernel calculation: 0 -k 0 -k 4k+1 -k 0 -k 0  (simplified Laplacian)
            // Or use the formula from the user script:
            // k = intensity, off = -((k - 1) / 4)
            // matrix = 0 off 0 off k off 0 off 0

            const k = this.settings.sharpness;
            const off = -((k - 1) / 4);
            const matrix = `0 ${off} 0 ${off} ${k} ${off} 0 ${off} 0`;

            if (this.elements.matrix) {
                this.elements.matrix.setAttribute('kernelMatrix', matrix);
            }

            // 2. 채도 (SVG feColorMatrix) update
            // CSS saturate filter is simpler, but since we use SVG filter for sharpness,
            // we can use feColorMatrix type="saturate" inside the same filter.
            if (this.elements.colorMatrix) {
                this.elements.colorMatrix.setAttribute('values', this.settings.saturation);
            }

            // 3. 대비/밝기 (CSS filter chaining)
            // video-enhanced 클래스에 SVG filter url이 이미 적용됨
            // 추가적인 CSS 속성 변수 업데이트
            video.style.setProperty('--contrast', `${this.settings.contrast}%`);
            video.style.setProperty('--brightness', `${this.settings.brightness}%`);
        }
    };

    // ========== 오디오 개선 (Audio Enhancement) ==========
    const AudioEnhancer = {
        context: null, source: null, gainNode: null, compressor: null, eqBands: [],
        freqs: [60, 250, 1000, 4000, 12000],
        settings: { enabled: false, boost: 100, compressor: false, eq: [0, 0, 0, 0, 0] },
        elements: {},

        init() {
            this.elements = {
                toggle: document.getElementById('audio-toggle'),
                boost: document.getElementById('audio-boost-slider'),
                compressor: document.getElementById('compressor-toggle'),
                reset: document.getElementById('reset-audio-btn'),
                eq: Array.from(document.querySelectorAll('.eq-slider'))
            };
            if (!this.elements.toggle) return;
            this.loadSettings();
            this.setupListeners();
        },
        loadSettings() {
            try {
                const s = JSON.parse(localStorage.getItem('audioEnhancementSettings'));
                if (s) this.settings = { ...this.settings, ...s };
            } catch (e) { }
            this.updateUI();
        },
        updateUI() {
            this.elements.toggle.checked = this.settings.enabled;
            this.elements.boost.value = this.settings.boost;
            this.elements.compressor.checked = this.settings.compressor;
            this.elements.eq.forEach((el, i) => el.value = this.settings.eq[i] || 0);
            document.getElementById('audio-boost-value').textContent = this.settings.boost + '%';
        },
        setupListeners() {
            const update = () => {
                this.updateNodes();
                this.updateUI();
                localStorage.setItem('audioEnhancementSettings', JSON.stringify(this.settings));
            };
            this.elements.toggle.onclick = (e) => { this.settings.enabled = e.target.checked; update(); };
            this.elements.boost.oninput = (e) => { this.settings.boost = +e.target.value; update(); };
            this.elements.compressor.onchange = (e) => { this.settings.compressor = e.target.checked; update(); };
            this.elements.eq.forEach((el, i) => el.oninput = (e) => { this.settings.eq[i] = +e.target.value; update(); });
            this.elements.reset.onclick = () => {
                this.settings = { enabled: false, boost: 100, compressor: false, eq: [0, 0, 0, 0, 0] };
                update();
            };
        },
        setupContext() {
            if (this.context) return;
            const AC = window.AudioContext || window.webkitAudioContext;
            this.context = new AC();
            if (!video) video = document.getElementById('video-player');
            if (!video.crossOrigin) video.crossOrigin = 'anonymous';

            try { this.source = this.context.createMediaElementSource(video); }
            catch (e) { return; }

            this.gainNode = this.context.createGain();
            this.compressor = this.context.createDynamicsCompressor();
            this.eqBands = this.freqs.map(f => {
                const bf = this.context.createBiquadFilter();
                bf.type = 'peaking'; bf.frequency.value = f; bf.Q.value = 1; bf.gain.value = 0;
                return bf;
            });

            let node = this.source;
            this.eqBands.forEach(b => { node.connect(b); node = b; });
            node.connect(this.compressor);
            this.compressor.connect(this.gainNode);
            this.gainNode.connect(this.context.destination);
        },
        updateNodes() {
            if (!this.context) {
                if (this.settings.enabled) this.setupContext();
                else return;
            }
            if (this.context && this.context.state === 'suspended') this.context.resume();
            if (!this.context) return;

            if (!this.settings.enabled) {
                this.gainNode.gain.value = 1;
                this.eqBands.forEach(b => b.gain.value = 0);
                this.compressor.threshold.value = 0;
                this.compressor.ratio.value = 1;
                return;
            }

            this.gainNode.gain.value = this.settings.boost / 100;
            this.eqBands.forEach((b, i) => b.gain.value = this.settings.eq[i]);

            if (this.settings.compressor) {
                this.compressor.threshold.value = -24;
                this.compressor.ratio.value = 12;
            } else {
                this.compressor.threshold.value = 0;
                this.compressor.ratio.value = 1;
            }
        }
    };

    // 초기화
    async function init() {
        console.log('[Player] Initializing...');

        currentChannel = getChannelFromUrl();

        if (!currentChannel) {
            showError('No channel specified. Use ?channel=channelname');
            return;
        }

        setupControls();

        // 탭 설정
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
            });
        });

        VideoEnhancer.init();
        AudioEnhancer.init();
        startStream(currentChannel);
    }

    // 페이지 언로드 시 정리
    window.addEventListener('beforeunload', () => {
        if (hls) {
            hls.destroy();
        }
    });

    // 페이지 로드 시 초기화
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
