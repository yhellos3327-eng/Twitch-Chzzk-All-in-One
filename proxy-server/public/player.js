import { elements, showLoading, showError, hideOverlays, updateMetadata } from './modules/ui.js';
import { getStreamInfo } from './modules/api.js';
import { loadChatIframe, refreshChat, openChatPopup } from './modules/chat.js';
import { VideoEnhancer } from './modules/video-enhancer.js';
import { AudioEnhancer } from './modules/audio-enhancer.js';

let hls = null;
let currentChannel = null;
let video = null;
let qualities = [];
let currentQualityIndex = 0;

function getChannelFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('channel');
}

function updateQualityMenu() {
    const menu = elements.qualityMenu();
    if (!menu) return;

    menu.innerHTML = qualities.map((q, i) => {
        let displayName = q.name;
        if (displayName.includes('source') || displayName.includes('Source')) displayName = 'Source';
        else if (q.resolution) displayName = q.resolution.split('x')[1] + 'p';
        return `<button class="control-text-btn quality-item ${i === currentQualityIndex ? 'active' : ''}" style="display:block; width:100%; text-align:left;" data-index="${i}">${displayName}</button>`;
    }).join('');

    menu.querySelectorAll('.quality-item').forEach(item => {
        item.addEventListener('click', () => {
            changeQuality(parseInt(item.dataset.index));
            menu.style.display = 'none';
        });
    });
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

    const badge = elements.qualityBadge();
    if (badge) {
        let text = 'HD';
        if (quality.name.toLowerCase().includes('source')) text = 'Source';
        else if (quality.resolution) text = quality.resolution.split('x')[1] + 'p';
        badge.textContent = text;
        badge.style.display = 'inline-block';
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
    const pipBtn = elements.pipBtn();
    if (pipBtn) pipBtn.addEventListener('click', () => {
        if (document.pictureInPictureElement) document.exitPictureInPicture();
        else video.requestPictureInPicture();
    });

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
}

async function startStream(channel) {
    showLoading('방송 연결 중...');
    try {
        const info = await getStreamInfo(channel);
        if (info.metadata) updateMetadata(info.metadata);

        qualities = info.qualities || [];
        if (qualities.length === 0) throw new Error('방송 정보를 불러올 수 없습니다.');

        video = elements.video();
        video.crossOrigin = "anonymous";

        if (Hls.isSupported()) {
            hls = new Hls({ debug: false, enableWorker: true, lowLatencyMode: true });
            setupHlsEvents(hls);
            // Auto select best quality (usually index 0 from server sort)
            hls.loadSource(qualities[0].url);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                hideOverlays();
                video.muted = true;
                video.play().catch(() => {
                    video.muted = true;
                    video.play();
                });
            });
        }

        updateQualityMenu();
        const badge = elements.qualityBadge();
        if (badge) badge.style.display = 'inline-block';

        loadChatIframe(channel);

    } catch (e) {
        console.error(e);
        showError(e.message || '방송 연결 실패');
    }
}

function init() {
    console.log('[Player] Init Module');
    currentChannel = getChannelFromUrl();
    if (!currentChannel) {
        showError('채널 정보가 없습니다. (?channel=...)');
        return;
    }

    setupControls();

    // Enhancers need DOM to be ready
    VideoEnhancer.init();
    AudioEnhancer.init();

    startStream(currentChannel);
}

document.addEventListener('DOMContentLoaded', init);
