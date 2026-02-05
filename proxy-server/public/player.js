import { elements, showLoading, showError, hideOverlays, updateMetadata } from './modules/ui.js';
import { getStreamInfo } from './modules/api.js';
import { loadChatIframe, refreshChat, openChatPopup } from './modules/chat.js';
import { VideoEnhancer } from './modules/video-enhancer.js';
import { AudioEnhancer } from './modules/audio-enhancer.js';
import { MediaTools } from './modules/media-tools.js';
import { Captions } from './modules/captions.js';
import { StreamStats } from './modules/stream-stats.js';
import { KeyboardShortcuts } from './modules/keyboard-shortcuts.js';
import { PlaybackSpeed } from './modules/playback-speed.js';
import { MultiView } from './modules/multiview.js';

let hls = null;
let currentChannel = null;
let video = null;
let qualities = [];
let currentQualityIndex = 0;

function getChannelFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('channel');
}

function isPopoutMode() {
    const params = new URLSearchParams(window.location.search);
    return params.get('popout') === 'true';
}

// Popout 모드 UI 설정
function setupPopoutMode() {
    console.log('[Player] Popout mode activated');

    // body에 popout 클래스 추가
    document.body.classList.add('popout-mode');

    // 채팅 컨테이너 숨기기
    const chatContainer = document.getElementById('chat-container');
    if (chatContainer) chatContainer.style.display = 'none';

    // 채팅 관련 버튼들 숨기기
    const chatButtons = document.querySelector('.controls-overlay-chat');
    if (chatButtons) chatButtons.style.display = 'none';

    // 상단바 간소화
    const topBar = document.getElementById('top-bar');
    if (topBar) {
        topBar.classList.add('popout-top-bar');
    }

    // 설정 버튼 숨기기
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) settingsBtn.style.display = 'none';

    // 도움말 버튼 숨기기
    const helpBtn = document.getElementById('help-btn');
    if (helpBtn) helpBtn.style.display = 'none';

    // 통계 버튼 숨기기
    const statsBtn = document.getElementById('stats-btn');
    if (statsBtn) statsBtn.style.display = 'none';

    // 녹화 버튼 숨기기
    const recordBtn = document.getElementById('record-btn');
    if (recordBtn) recordBtn.style.display = 'none';

    // 스크린샷 버튼 숨기기
    const screenshotBtn = document.getElementById('screenshot-btn');
    if (screenshotBtn) screenshotBtn.style.display = 'none';

    // 자막 버튼 숨기기
    const captionBtn = document.getElementById('caption-btn');
    if (captionBtn) captionBtn.style.display = 'none';

    // 시크바 영역 간소화
    const seekbarContainer = document.getElementById('seekbar-container');
    if (seekbarContainer) {
        seekbarContainer.classList.add('popout-seekbar');
    }

    // 컨트롤바 간소화
    const controlBar = document.getElementById('control-bar');
    if (controlBar) {
        controlBar.classList.add('popout-control-bar');
    }

    // Popout 전용 스타일 주입
    injectPopoutStyles();

    // 윈도우 타이틀 설정
    document.title = `${currentChannel || 'Stream'} - Popout`;
}

// Popout 전용 CSS 스타일
function injectPopoutStyles() {
    const style = document.createElement('style');
    style.id = 'popout-styles';
    style.textContent = `
        /* Popout Mode Styles */
        body.popout-mode {
            background: #000;
        }

        body.popout-mode #player-container {
            border-radius: 0;
        }

        /* 상단바 간소화 */
        body.popout-mode .popout-top-bar {
            padding: 8px 12px;
            background: linear-gradient(180deg, rgba(0,0,0,0.8) 0%, transparent 100%);
        }

        body.popout-mode .popout-top-bar .controls-right {
            gap: 8px;
        }

        body.popout-mode .popout-top-bar .profile-container {
            width: 32px;
            height: 32px;
        }

        body.popout-mode .popout-top-bar .live-badge {
            font-size: 9px;
            padding: 1px 4px;
        }

        body.popout-mode .popout-top-bar .text-info {
            gap: 2px;
        }

        body.popout-mode .popout-top-bar #channel-name {
            font-size: 13px;
        }

        body.popout-mode .popout-top-bar .title-row {
            font-size: 11px;
        }

        body.popout-mode .popout-top-bar #stream-title {
            max-width: 200px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        body.popout-mode .popout-top-bar #game-name {
            display: none;
        }

        body.popout-mode .popout-top-bar #viewer-count-container {
            font-size: 11px;
            padding: 4px 8px;
        }

        /* 컨트롤바 간소화 */
        body.popout-mode .popout-control-bar {
            padding: 8px 12px;
            gap: 8px;
        }

        body.popout-mode .popout-control-bar .control-btn {
            width: 32px;
            height: 32px;
        }

        body.popout-mode .popout-control-bar .control-btn svg {
            width: 18px;
            height: 18px;
        }

        body.popout-mode .popout-control-bar .volume-slider {
            width: 60px;
        }

        body.popout-mode .popout-control-bar .control-center {
            gap: 4px;
        }

        body.popout-mode .popout-control-bar .control-divider {
            display: none;
        }

        body.popout-mode .popout-control-bar .go-live-btn {
            padding: 4px 8px;
            font-size: 10px;
        }

        body.popout-mode .popout-control-bar .quality-wrapper button {
            font-size: 11px;
            padding: 4px 8px;
        }

        /* 시크바 간소화 */
        body.popout-mode .popout-seekbar {
            padding: 0 12px 4px;
        }

        body.popout-mode .popout-seekbar .seekbar-wrapper {
            height: 3px;
        }

        body.popout-mode .popout-seekbar .seekbar-wrapper:hover {
            height: 5px;
        }

        body.popout-mode .popout-seekbar .seekbar-times {
            font-size: 10px;
            margin-top: 4px;
        }

        /* 비디오 영역 최대화 */
        body.popout-mode #video-player {
            border-radius: 0;
        }

        /* 시청자 수 컨테이너 표시 */
        body.popout-mode #viewer-count-container {
            display: flex !important;
        }

        /* PIP 버튼 숨기기 (popout에서는 의미 없음) */
        body.popout-mode #pip-btn {
            display: none;
        }

        /* 전체화면 버튼만 표시 */
        body.popout-mode .control-right {
            gap: 6px;
        }

        /* 호버 시 컨트롤 표시 */
        body.popout-mode #player-container:not(:hover) .popout-top-bar,
        body.popout-mode #player-container:not(:hover) .popout-control-bar,
        body.popout-mode #player-container:not(:hover) .popout-seekbar {
            opacity: 0;
        }

        body.popout-mode .popout-top-bar,
        body.popout-mode .popout-control-bar,
        body.popout-mode .popout-seekbar {
            transition: opacity 0.3s ease;
        }

        /* 전체화면 시 추가 간소화 */
        body.popout-mode:fullscreen .popout-top-bar {
            padding: 12px 16px;
        }

        body.popout-mode:fullscreen .popout-control-bar {
            padding: 12px 16px;
        }
    `;
    document.head.appendChild(style);
}

// 오디오 전용인지 확인
function isAudioOnly(quality) {
    const name = (quality.name || '').toLowerCase();
    return name.includes('audio_only') || name.includes('audio only');
}

// 최고 화질(비디오) 인덱스 찾기
function findBestVideoQualityIndex(qualityList) {
    for (let i = 0; i < qualityList.length; i++) {
        if (!isAudioOnly(qualityList[i])) {
            return i;
        }
    }
    return 0;
}

function getQualityDisplayName(quality) {
    const name = quality.name?.toLowerCase() || '';

    // 오디오 전용
    if (name.includes('audio_only') || name.includes('audio only')) {
        return 'Audio Only';
    }

    // 해상도가 있으면 해상도 기반으로 표시
    if (quality.resolution) {
        const height = quality.resolution.split('x')[1];
        const fps = quality.fps ? Math.round(parseFloat(quality.fps)) : null;

        if (height === '1080') return fps && fps >= 60 ? '1080p60' : '1080p';
        if (height === '720') return fps && fps >= 60 ? '720p60' : '720p';
        if (height === '480') return '480p';
        if (height === '360') return '360p';
        if (height === '160') return '160p';
        return height + 'p';
    }

    // Source/원본
    if (name.includes('source') || name.includes('chunked')) {
        return '1080p (Source)';
    }

    // 이름에서 해상도 추출 시도
    const resMatch = name.match(/(\d{3,4})p/i);
    if (resMatch) {
        return resMatch[1] + 'p';
    }

    return quality.name || 'Auto';
}

// 화질 목록 정렬 (해상도 높은 순서로)
function sortQualities(qualityList) {
    return [...qualityList].sort((a, b) => {
        // 해상도 추출 함수
        const getResolutionHeight = (q) => {
            // resolution 필드에서 추출
            if (q.resolution) {
                const height = parseInt(q.resolution.split('x')[1]);
                if (!isNaN(height)) return height;
            }
            // name에서 추출
            const name = (q.name || '').toLowerCase();
            const match = name.match(/(\d{3,4})p/);
            if (match) return parseInt(match[1]);
            // source/chunked는 최고 화질로 취급
            if (name.includes('source') || name.includes('chunked')) return 9999;
            // audio only는 맨 아래
            if (name.includes('audio')) return 0;
            return 100; // 기본값
        };

        // FPS 추출
        const getFPS = (q) => {
            if (q.fps) return parseFloat(q.fps);
            const name = (q.name || '').toLowerCase();
            if (name.includes('60')) return 60;
            return 30;
        };

        const heightA = getResolutionHeight(a);
        const heightB = getResolutionHeight(b);

        // 해상도로 먼저 정렬 (높은 것 먼저)
        if (heightA !== heightB) {
            return heightB - heightA;
        }

        // 같은 해상도면 FPS로 정렬 (높은 것 먼저)
        return getFPS(b) - getFPS(a);
    });
}

function updateQualityMenu() {
    const menu = elements.qualityMenu();
    if (!menu) return;

    // 화질 목록 정렬
    const sortedQualities = sortQualities(qualities);

    // 원본 배열 업데이트 (currentQualityIndex도 조정 필요)
    const currentQualityUrl = qualities[currentQualityIndex]?.url;
    qualities = sortedQualities;

    // 현재 선택된 화질의 새 인덱스 찾기
    if (currentQualityUrl) {
        const newIndex = qualities.findIndex(q => q.url === currentQualityUrl);
        if (newIndex !== -1) {
            currentQualityIndex = newIndex;
        }
    }

    // 오디오 옵션 인덱스 찾기
    const audioIndex = qualities.findIndex(q => {
        const name = (q.name || '').toLowerCase();
        return name.includes('audio');
    });

    menu.innerHTML = qualities.map((q, i) => {
        const displayName = getQualityDisplayName(q);
        const isAudio = (q.name || '').toLowerCase().includes('audio');

        // 오디오 옵션 앞에 구분선 추가
        let separator = '';
        if (i === audioIndex && audioIndex > 0) {
            separator = '<div class="quality-divider"><span>오디오</span></div>';
        }

        return `${separator}<button class="quality-item ${i === currentQualityIndex ? 'active' : ''} ${isAudio ? 'audio-only' : ''}" data-index="${i}">${displayName}</button>`;
    }).join('');

    // quality-btn 텍스트도 현재 화질로 업데이트
    const qualityBtn = elements.qualityBtn();
    if (qualityBtn && qualities[currentQualityIndex]) {
        qualityBtn.textContent = getQualityDisplayName(qualities[currentQualityIndex]);
    }

    menu.querySelectorAll('.quality-item').forEach(item => {
        item.addEventListener('click', () => {
            changeQuality(parseInt(item.dataset.index));
            menu.style.display = 'none';
        });
    });
}

// 화질 목록 정기 감시 (30초마다)
let qualityWatchInterval = null;
function startQualityWatch() {
    if (qualityWatchInterval) return;

    qualityWatchInterval = setInterval(() => {
        if (qualities.length > 0) {
            // 정렬 상태 확인
            const sorted = sortQualities(qualities);
            const needsSort = sorted.some((q, i) => q.url !== qualities[i]?.url);

            if (needsSort) {
                console.log('[Player] Re-sorting quality list');
                updateQualityMenu();
            }
        }
    }, 30000); // 30초마다 체크
}

function changeQuality(index) {
    if (index < 0 || index >= qualities.length) return;
    currentQualityIndex = index;
    const quality = qualities[index];

    const wasPlaying = !video.paused;
    if (hls) hls.destroy();

    if (Hls.isSupported()) {
        hls = new Hls({ debug: false, enableWorker: true, lowLatencyMode: true });
        setupHlsEvents(hls);
        hls.loadSource(quality.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (wasPlaying) video.play();
        });
    }

    const displayName = getQualityDisplayName(quality);

    // quality-btn 텍스트 업데이트
    const qualityBtn = elements.qualityBtn();
    if (qualityBtn) {
        qualityBtn.textContent = displayName;
    }
}

function setupHlsEvents(hlsInstance) {
    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
            switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                    hlsInstance.startLoad();
                    break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                    hlsInstance.recoverMediaError();
                    break;
                default:
                    console.error('HLS Fatal Error', data);
                    break;
            }
        }
    });
}

function setupControls() {
    video = elements.video();

    // Play/Pause
    const ppBtn = elements.playPauseBtn();
    if (ppBtn) {
        ppBtn.addEventListener('click', () => {
            if (video.paused) video.play();
            else video.pause();
        });
        video.addEventListener('play', () => {
            ppBtn.querySelector('.icon-play').style.display = 'none';
            ppBtn.querySelector('.icon-pause').style.display = 'block';
        });
        video.addEventListener('pause', () => {
            ppBtn.querySelector('.icon-play').style.display = 'block';
            ppBtn.querySelector('.icon-pause').style.display = 'none';
        });
    }

    // Mute/Volume
    const muteBtn = elements.muteBtn();
    const volSlider = elements.volumeSlider();

    function updateVolumeUI() {
        const isMuted = video.muted || video.volume === 0;
        if (muteBtn) {
            muteBtn.querySelector('.icon-volume').style.display = isMuted ? 'none' : 'block';
            muteBtn.querySelector('.icon-muted').style.display = isMuted ? 'block' : 'none';
        }
        if (volSlider) volSlider.value = isMuted ? 0 : video.volume * 100;
    }

    if (muteBtn) {
        muteBtn.addEventListener('click', () => {
            video.muted = !video.muted;
            updateVolumeUI();
        });
    }
    if (volSlider) {
        volSlider.addEventListener('input', e => {
            video.volume = e.target.value / 100;
            if (video.volume > 0) video.muted = false;
            updateVolumeUI();
        });
    }
    video.addEventListener('volumechange', updateVolumeUI);

    // Quality Menu
    const qBtn = elements.qualityBtn();
    const qMenu = elements.qualityMenu();
    if (qBtn && qMenu) {
        qBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            qMenu.style.display = qMenu.style.display === 'block' ? 'none' : 'block';
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.quality-wrapper')) qMenu.style.display = 'none';
        });
    }

    // Fullscreen / PIP
    const fsBtn = elements.fullscreenBtn();
    if (fsBtn) fsBtn.addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.getElementById('player-container').requestFullscreen();
    });
    // PIP는 MultiView 모듈에서 관리
    // pipBtn 이벤트는 multiview.js의 setupEventListeners에서 설정됨

    // Chat Toggles
    const toggleChat = elements.toggleChatBtn();
    if (toggleChat) toggleChat.addEventListener('click', () => {
        const app = elements.app();
        if (app) app.classList.toggle('chat-visible');
        else {
            // Fallback if app class not found
            const chat = elements.chatContainer();
            if (chat) {
                const isVis = chat.style.right === '0px';
                chat.style.right = isVis ? '-340px' : '0';
            }
        }
    });
    const refresh = elements.refreshChatBtn();
    if (refresh) refresh.addEventListener('click', () => refreshChat(currentChannel));
    const popout = elements.popoutChatBtn();
    if (popout) popout.addEventListener('click', () => openChatPopup(currentChannel));

    // Settings Menu
    const setsBtn = elements.settingsBtn();
    const setsMenu = elements.settingsMenu();
    if (setsBtn && setsMenu) {
        setsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setsMenu.style.display = setsMenu.style.display === 'flex' ? 'none' : 'flex';
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.settings-menu') && e.target.id !== 'settings-btn' && !e.target.closest('#settings-btn')) {
                setsMenu.style.display = 'none';
            }
        });
    }

    // Settings Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => {
                c.style.display = 'none';
                c.classList.remove('active');
            });

            btn.classList.add('active');
            const target = document.getElementById('tab-' + btn.dataset.tab);
            if (target) {
                target.style.display = 'block';
                target.classList.add('active');
            }
        });
    });

    // Profile & Channel Name -> Go to Twitch channel
    const profileContainer = elements.profileContainer();
    const channelNameEl = elements.channelName();

    const goToChannel = () => {
        if (currentChannel) {
            window.open(`https://www.twitch.tv/${currentChannel}`, '_blank');
        }
    };

    if (profileContainer) {
        profileContainer.style.cursor = 'pointer';
        profileContainer.addEventListener('click', goToChannel);
    }
    if (channelNameEl) {
        channelNameEl.style.cursor = 'pointer';
        channelNameEl.addEventListener('click', goToChannel);
    }

    // Media Tools Controls
    const screenshotBtn = document.getElementById('screenshot-btn');
    const recordBtn = document.getElementById('record-btn');
    const seekBackBtn = document.getElementById('seek-back-btn');
    const seekForwardBtn = document.getElementById('seek-forward-btn');
    const goLiveBtn = document.getElementById('go-live-btn');

    if (screenshotBtn) {
        screenshotBtn.addEventListener('click', () => MediaTools.takeScreenshot());
    }
    if (recordBtn) {
        recordBtn.addEventListener('click', () => {
            if (MediaTools.isRecording) {
                MediaTools.stopRecording();
            } else {
                MediaTools.startRecording();
            }
        });
    }
    if (seekBackBtn) {
        seekBackBtn.addEventListener('click', () => MediaTools.seekBackward(10));
    }
    if (seekForwardBtn) {
        seekForwardBtn.addEventListener('click', () => MediaTools.seekForward(10));
    }
    if (goLiveBtn) {
        goLiveBtn.addEventListener('click', () => MediaTools.goLive());
    }

    // Captions Button
    const captionBtn = document.getElementById('caption-btn');
    if (captionBtn) {
        captionBtn.addEventListener('click', () => {
            Captions.toggle();
            captionBtn.classList.toggle('active', Captions.isActive);
        });
    }

    // Stats Button
    const statsBtn = document.getElementById('stats-btn');
    if (statsBtn) {
        statsBtn.addEventListener('click', () => StreamStats.toggle());
    }

    // Speed Buttons
    const speedDownBtn = document.getElementById('speed-down-btn');
    const speedUpBtn = document.getElementById('speed-up-btn');
    const speedResetBtn = document.getElementById('speed-reset-btn');

    if (speedDownBtn) speedDownBtn.addEventListener('click', () => PlaybackSpeed.speedDown());
    if (speedUpBtn) speedUpBtn.addEventListener('click', () => PlaybackSpeed.speedUp());
    if (speedResetBtn) speedResetBtn.addEventListener('click', () => PlaybackSpeed.reset());

    // Help Button
    const helpBtn = document.getElementById('help-btn');
    if (helpBtn) {
        helpBtn.addEventListener('click', () => KeyboardShortcuts.toggleHelp());
    }

    // Seekbar setup
    setupSeekbar();
}

// ==================== 재생바 (Seekbar) ====================
let seekbarUpdateInterval = null;

function setupSeekbar() {
    const seekbarInput = document.getElementById('seekbar-input');
    const seekbarProgress = document.getElementById('seekbar-progress');
    const seekbarBuffer = document.getElementById('seekbar-buffer');
    const seekbarThumb = document.getElementById('seekbar-thumb');
    const seekbarCurrent = document.getElementById('seekbar-current');
    const seekbarTooltip = document.getElementById('seekbar-tooltip');
    const seekbarLive = document.getElementById('seekbar-live-indicator');
    const seekbarWrapper = document.querySelector('.seekbar-wrapper');

    if (!seekbarInput) return;

    // 시크바 업데이트
    function updateSeekbar() {
        if (!video || !video.buffered.length) return;

        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const currentTime = video.currentTime;
        const behindLive = bufferedEnd - currentTime;

        // 진행바 위치 (버퍼 끝 기준으로 상대적 위치)
        const progress = bufferedEnd > 0 ? (currentTime / bufferedEnd) * 100 : 100;
        seekbarProgress.style.width = `${progress}%`;
        seekbarThumb.style.left = `${progress}%`;

        // 버퍼 표시 (항상 100%)
        seekbarBuffer.style.width = '100%';

        // 현재 시간 표시 (라이브 대비)
        if (behindLive > 1) {
            const mins = Math.floor(behindLive / 60);
            const secs = Math.floor(behindLive % 60);
            seekbarCurrent.textContent = `-${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            seekbarCurrent.classList.add('behind');
            seekbarLive.classList.add('not-live');
        } else {
            seekbarCurrent.textContent = 'LIVE';
            seekbarCurrent.classList.remove('behind');
            seekbarLive.classList.remove('not-live');
        }

        // 슬라이더 값 업데이트
        seekbarInput.value = progress;
    }

    // 주기적 업데이트
    seekbarUpdateInterval = setInterval(updateSeekbar, 250);

    // 시크바 드래그
    let isDragging = false;

    seekbarInput.addEventListener('input', (e) => {
        if (!video || !video.buffered.length) return;

        const percent = parseFloat(e.target.value);
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const newTime = (percent / 100) * bufferedEnd;

        video.currentTime = newTime;
        updateSeekbar();
    });

    seekbarInput.addEventListener('mousedown', () => isDragging = true);
    seekbarInput.addEventListener('mouseup', () => isDragging = false);

    // 툴팁 표시
    seekbarWrapper?.addEventListener('mousemove', (e) => {
        if (!video || !video.buffered.length) return;

        const rect = seekbarWrapper.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const time = percent * bufferedEnd;
        const behindLive = bufferedEnd - time;

        if (behindLive > 1) {
            const mins = Math.floor(behindLive / 60);
            const secs = Math.floor(behindLive % 60);
            seekbarTooltip.textContent = `-${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            seekbarTooltip.textContent = 'LIVE';
        }

        seekbarTooltip.style.left = `${percent * 100}%`;
    });

    // LIVE 클릭시 라이브로 이동
    seekbarLive?.addEventListener('click', () => {
        MediaTools.goLive();
    });
}

async function startStream(channel, retryCount = 0) {
    showLoading('방송 연결 중...');
    try {
        const info = await getStreamInfo(channel);
        if (info.metadata) updateMetadata(info.metadata);

        qualities = info.qualities || [];
        if (qualities.length === 0) throw new Error('방송 정보를 불러올 수 없습니다.');

        video = elements.video();
        video.crossOrigin = "anonymous";

        if (Hls.isSupported()) {
            // 기존 HLS 인스턴스 정리
            if (hls) {
                hls.destroy();
                hls = null;
            }

            hls = new Hls({ debug: false, enableWorker: true, lowLatencyMode: true });
            setupHlsEvents(hls);

            // 최고 비디오 화질 선택 (오디오 전용 제외)
            const bestIndex = findBestVideoQualityIndex(qualities);
            currentQualityIndex = bestIndex;
            console.log('[Player] Selected quality:', getQualityDisplayName(qualities[bestIndex]));

            hls.loadSource(qualities[bestIndex].url);
            hls.attachMedia(video);

            // 검은 화면 감지 타이머
            let blackScreenTimer = null;
            let videoStarted = false;

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                hideOverlays();
                video.muted = true;
                video.play().catch(() => {
                    video.muted = true;
                    video.play();
                });

                // 3초 후 검은 화면 체크
                blackScreenTimer = setTimeout(() => {
                    if (!videoStarted && video.readyState < 3) {
                        console.warn('[Player] Black screen detected, retrying...');
                        retryVideoStream(channel, retryCount);
                    }
                }, 3000);

                // Activate audio enhancer after video is playing
                setTimeout(() => {
                    AudioEnhancer.activate();
                }, 500);

                // Initialize MediaTools after video is ready
                MediaTools.init(video, channel);

                // Initialize MultiView (PIP alternatives & multi-stream)
                MultiView.init(video, channel);

                // Initialize StreamStats with HLS instance
                StreamStats.init(hls, video);

                // Set stream start time for uptime
                if (info.metadata?.stream?.startedAt) {
                    StreamStats.setStreamStartTime(info.metadata.stream.startedAt);
                }

                // Initialize PlaybackSpeed
                PlaybackSpeed.init(video);
            });

            // 비디오 재생 시작 감지
            video.addEventListener('playing', () => {
                videoStarted = true;
                if (blackScreenTimer) {
                    clearTimeout(blackScreenTimer);
                    blackScreenTimer = null;
                }
            }, { once: true });

            // 비디오 데이터 로드 감지
            video.addEventListener('loadeddata', () => {
                if (video.videoWidth > 0 && video.videoHeight > 0) {
                    videoStarted = true;
                    if (blackScreenTimer) {
                        clearTimeout(blackScreenTimer);
                        blackScreenTimer = null;
                    }
                }
            }, { once: true });
        }

        updateQualityMenu();
        startQualityWatch(); // 화질 목록 정기 감시 시작

        // Popout 모드가 아닐 때만 채팅 로드
        if (!isPopoutMode()) {
            loadChatIframe(channel);
        }

    } catch (e) {
        console.error(e);
        showError(e.message || '방송 연결 실패');
    }
}

// 비디오만 재시도 (채팅은 유지)
function retryVideoStream(channel, retryCount) {
    if (retryCount >= 3) {
        showError('비디오 연결 실패. 새로고침을 시도해주세요.');
        return;
    }

    console.log(`[Player] Retrying video stream (attempt ${retryCount + 1}/3)...`);
    showLoading(`재연결 중... (${retryCount + 1}/3)`);

    // HLS 정리
    if (hls) {
        hls.destroy();
        hls = null;
    }

    // 잠시 후 다시 시도
    setTimeout(async () => {
        try {
            const info = await getStreamInfo(channel);
            qualities = info.qualities || [];

            if (qualities.length === 0) {
                throw new Error('스트림을 찾을 수 없습니다.');
            }

            video = elements.video();
            video.crossOrigin = "anonymous";

            hls = new Hls({ debug: false, enableWorker: true, lowLatencyMode: true });
            setupHlsEvents(hls);

            // 최고 비디오 화질 선택 (오디오 전용 제외)
            const bestIndex = findBestVideoQualityIndex(qualities);
            currentQualityIndex = bestIndex;

            hls.loadSource(qualities[bestIndex].url);
            hls.attachMedia(video);

            let retryStarted = false;

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                hideOverlays();
                video.muted = true;
                video.play().catch(() => {
                    video.muted = true;
                    video.play();
                });

                // 3초 후 다시 검은 화면 체크
                setTimeout(() => {
                    if (!retryStarted && video.readyState < 3) {
                        retryVideoStream(channel, retryCount + 1);
                    }
                }, 3000);
            });

            video.addEventListener('playing', () => {
                retryStarted = true;
                console.log('[Player] Video stream recovered');
            }, { once: true });

            video.addEventListener('loadeddata', () => {
                if (video.videoWidth > 0 && video.videoHeight > 0) {
                    retryStarted = true;
                }
            }, { once: true });

            updateQualityMenu();

        } catch (e) {
            console.error('[Player] Retry failed:', e);
            retryVideoStream(channel, retryCount + 1);
        }
    }, 1000);
}

function init() {
    console.log('[Player] Init Module');
    currentChannel = getChannelFromUrl();
    if (!currentChannel) {
        showError('채널 정보가 없습니다. (?channel=...)');
        return;
    }

    // Popout 모드 체크 및 UI 설정
    if (isPopoutMode()) {
        setupPopoutMode();
    }

    setupControls();

    // Enhancers need DOM to be ready
    VideoEnhancer.init();
    AudioEnhancer.init();

    // Initialize Captions with video element
    Captions.init(video);

    // Initialize Keyboard Shortcuts with handlers
    KeyboardShortcuts.init({
        // 재생 컨트롤
        togglePlay: () => {
            if (video) video.paused ? video.play() : video.pause();
        },
        // 볼륨
        toggleMute: () => {
            if (video) video.muted = !video.muted;
        },
        volumeUp: () => {
            if (video) video.volume = Math.min(1, video.volume + 0.05);
        },
        volumeDown: () => {
            if (video) video.volume = Math.max(0, video.volume - 0.05);
        },
        // 탐색
        seekBack5: () => MediaTools.seekBackward(5),
        seekBack10: () => MediaTools.seekBackward(10),
        seekBack30: () => MediaTools.seekBackward(30),
        seekForward5: () => MediaTools.seekForward(5),
        seekForward10: () => MediaTools.seekForward(10),
        seekForward30: () => MediaTools.seekForward(30),
        goLive: () => MediaTools.goLive(),
        // 미디어
        screenshot: () => MediaTools.takeScreenshot(),
        toggleRecording: () => {
            if (MediaTools.isRecording) {
                MediaTools.stopRecording();
            } else {
                MediaTools.startRecording();
            }
        },
        // 화면
        toggleFullscreen: () => {
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                document.getElementById('player-container')?.requestFullscreen();
            }
        },
        togglePIP: async () => {
            try {
                if (!document.pictureInPictureElement) {
                    await video?.requestPictureInPicture();
                } else {
                    await document.exitPictureInPicture();
                }
            } catch (e) { console.error('[PIP]', e); }
        },
        toggleTheater: () => {
            document.getElementById('player-container')?.classList.toggle('theater-mode');
        },
        // 자막
        toggleCaptions: () => {
            Captions.toggle();
            document.getElementById('caption-btn')?.classList.toggle('active', Captions.isActive);
        },
        toggleTranslation: () => Captions.toggleTranslation(),
        // 채팅
        toggleChat: () => {
            const container = document.getElementById('player-container');
            container?.classList.toggle('chat-visible');
        },
        // 속도
        speedUp: () => PlaybackSpeed.speedUp(),
        speedDown: () => PlaybackSpeed.speedDown(),
        speedReset: () => PlaybackSpeed.reset(),
        // 화질
        quality1: () => changeQuality(qualities.length - 1),
        quality2: () => changeQuality(Math.floor(qualities.length * 0.75)),
        quality3: () => changeQuality(Math.floor(qualities.length * 0.5)),
        quality4: () => changeQuality(Math.floor(qualities.length * 0.25)),
        quality5: () => changeQuality(0),
        // 기타
        toggleStats: () => StreamStats.toggle(),
        toggleHelp: () => KeyboardShortcuts.toggleHelp(),
        closeOverlays: () => {
            KeyboardShortcuts.hideHelp();
            StreamStats.hide();
            document.getElementById('settings-menu').style.display = 'none';
            document.getElementById('quality-menu').style.display = 'none';
        }
    });

    // Popout 모드가 아닐 때만 채팅 표시
    if (!isPopoutMode() && window.innerWidth > 1000) {
        const app = elements.app();
        if (app) app.classList.add('chat-visible');
    }

    startStream(currentChannel);
}

document.addEventListener('DOMContentLoaded', init);
