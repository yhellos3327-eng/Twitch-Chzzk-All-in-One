export const elements = {
    video: () => document.getElementById('video-player'),

    // Top Bar
    channelInfoGroup: () => document.querySelector('.channel-info-group'),
    profileImage: () => document.getElementById('profile-image'),
    channelName: () => document.getElementById('channel-name'),
    streamTitle: () => document.getElementById('stream-title'),
    gameName: () => document.getElementById('game-name'),
    viewerCount: () => document.getElementById('viewer-count'),
    viewerCountContainer: () => document.getElementById('viewer-count-container'),
    settingsBtn: () => document.getElementById('settings-btn'),
    settingsMenu: () => document.getElementById('settings-menu'),

    // Control Bar
    controlBar: () => document.getElementById('control-bar'),
    playPauseBtn: () => document.getElementById('play-pause-btn'),
    muteBtn: () => document.getElementById('mute-btn'),
    volumeSlider: () => document.getElementById('volume-slider'),
    qualityBtn: () => document.getElementById('quality-btn'),
    qualityMenu: () => document.getElementById('quality-menu'),
    qualityBadge: () => document.getElementById('quality-badge'),
    currentQuality: () => document.getElementById('current-quality'),
    pipBtn: () => document.getElementById('pip-btn'),
    fullscreenBtn: () => document.getElementById('fullscreen-btn'),
    openTwitchBtn: () => document.getElementById('open-twitch'),
    retryBtn: () => document.getElementById('retry-btn'),

    // Chat
    chatContainer: () => document.getElementById('chat-container'),
    chatIframe: () => document.getElementById('chat-iframe'),
    toggleChatBtn: () => document.getElementById('toggle-chat'),
    refreshChatBtn: () => document.getElementById('refresh-chat'),
    popoutChatBtn: () => document.getElementById('popout-chat'),
    sidebar: () => document.getElementById('sidebar'),
    app: () => document.querySelector('.app'),

    // Overlays
    loadingOverlay: () => document.getElementById('loading-overlay'),
    errorOverlay: () => document.getElementById('error-overlay'),
    errorMessage: () => document.getElementById('error-message'),
};

export function showLoading(message = '방송 연결 중...') {
    const overlay = elements.loadingOverlay();
    if (overlay) {
        overlay.style.display = 'flex';
        const msg = overlay.querySelector('span');
        if (msg) msg.textContent = message;
    }
    const err = elements.errorOverlay();
    if (err) err.style.display = 'none';
}

export function showError(message) {
    const loader = elements.loadingOverlay();
    if (loader) loader.style.display = 'none';
    const overlay = elements.errorOverlay();
    if (overlay) {
        overlay.style.display = 'flex';
        const msg = document.getElementById('error-message');
        if (msg) msg.textContent = message;
    }
}

export function hideOverlays() {
    const loader = elements.loadingOverlay();
    if (loader) loader.style.display = 'none';
    const err = elements.errorOverlay();
    if (err) err.style.display = 'none';
}

export function updateMetadata(meta) {
    if (!meta) return;
    try {
        const profile = elements.profileImage();
        if (profile && meta.profileImageURL) {
            profile.src = meta.profileImageURL;
            profile.style.display = 'block';
        }
        const nameEl = elements.channelName();
        if (nameEl) nameEl.textContent = meta.displayName;

        if (meta.stream) {
            const titleEl = elements.streamTitle();
            if (titleEl) titleEl.textContent = meta.stream.title;
            const gameEl = elements.gameName();
            if (gameEl) gameEl.textContent = meta.stream.game?.displayName || '';

            const viewers = elements.viewerCount();
            const vContainer = elements.viewerCountContainer();
            if (viewers) viewers.textContent = meta.stream.viewersCount.toLocaleString();
            if (vContainer) vContainer.style.display = 'flex';

            document.title = `${meta.displayName} - ${meta.stream.title}`;
        }
    } catch (e) { console.error('[Meta] UI Update Failed', e); }
}
