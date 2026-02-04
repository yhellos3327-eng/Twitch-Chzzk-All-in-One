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
        menu.innerHTML = qualities.map((q, i) => `
      <div class="quality-item ${i === currentQualityIndex ? 'active' : ''}" data-index="${i}">
        ${q.name} ${q.resolution ? `<span style="color:#888">${q.resolution.split('x')[1]}p</span>` : ''}
      </div>
    `).join('');

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
    function loadChatIframe(channel) {
        const chatIframe = elements.chatIframe();

        if (!chatIframe) {
            console.warn('[Chat] Chat iframe not found');
            return;
        }

        // Twitch 채팅 팝아웃 URL (darkpopout으로 다크모드 적용)
        const chatUrl = `https://www.twitch.tv/popout/${channel}/chat?darkpopout`;

        console.log('[Chat] Loading chat iframe:', chatUrl);

        chatIframe.src = chatUrl;
    }

    // 채팅 새로고침
    function refreshChat() {
        const chatIframe = elements.chatIframe();

        if (chatIframe && currentChannel) {
            console.log('[Chat] Refreshing chat');
            const chatUrl = `https://www.twitch.tv/popout/${currentChannel}/chat?darkpopout`;
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
                video.play().catch(e => console.warn('[Player] Autoplay failed:', e));
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
        });

        video.addEventListener('volumechange', () => {
            const muted = video.muted || video.volume === 0;
            elements.muteBtn().querySelector('.icon-volume').style.display = muted ? 'none' : 'block';
            elements.muteBtn().querySelector('.icon-muted').style.display = muted ? 'block' : 'none';
            elements.volumeSlider().value = muted ? 0 : video.volume * 100;
        });

        // 볼륨 슬라이더
        elements.volumeSlider().addEventListener('input', (e) => {
            video.volume = e.target.value / 100;
            video.muted = false;
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

    // 초기화
    async function init() {
        console.log('[Player] Initializing...');

        currentChannel = getChannelFromUrl();

        if (!currentChannel) {
            showError('No channel specified. Use ?channel=channelname');
            return;
        }

        setupControls();
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
