// Stream Bypass - Player Page Script

(function () {
  'use strict';

  const TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

  // 광고 차단을 위한 플레이어 타입들
  const AD_FREE_PLAYER_TYPES = ['embed', 'popout', 'site'];
  const AD_SIGNIFIER = 'stitched';

  let hls = null;
  let video = null;
  let settings = null;
  let currentChannel = null;
  let qualities = [];
  let currentQualityIndex = 0;
  let adDetected = false;

  // URL에서 채널명 추출
  function getChannelFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('channel');
  }

  // 설정 로드
  async function loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      settings = response;
      console.log('[Player] Settings loaded:', settings);
    } catch (e) {
      console.error('[Player] Failed to load settings:', e);
    }
  }

  // Twitch GQL API로 토큰 가져오기
  async function getAccessToken(channel, playerType = 'embed') {
    const query = {
      operationName: 'PlaybackAccessToken_Template',
      query: `query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {
        streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {
          value
          signature
          __typename
        }
        videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) {
          value
          signature
          __typename
        }
      }`,
      variables: {
        isLive: true,
        login: channel,
        isVod: false,
        vodID: '',
        playerType: playerType
      }
    };

    const response = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(query),
    });

    if (!response.ok) {
      throw new Error(`Failed to get access token: HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log('[Player] Token response for playerType', playerType);

    if (!data.data?.streamPlaybackAccessToken) {
      throw new Error('Stream not found or offline');
    }

    return data.data.streamPlaybackAccessToken;
  }

  // Playlist 가져오기
  async function getPlaylist(channel, token, sig) {
    const proxyUrl = settings?.twitch?.proxyUrl?.replace(/\/$/, '');

    const params = new URLSearchParams({
      allow_source: 'true',
      allow_audio_only: 'true',
      allow_spectre: 'true',
      p: Math.floor(Math.random() * 999999).toString(),
      player: 'twitchweb',
      playlist_include_framerate: 'true',
      segment_preference: '4',
      sig: sig,
      token: token,
    });

    const playlistUrl = `https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8?${params.toString()}`;
    const url = proxyUrl ? `${proxyUrl}/proxy?url=${encodeURIComponent(playlistUrl)}` : playlistUrl;
    console.log('[Player] Fetching playlist via:', proxyUrl ? 'proxy' : 'direct');

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to get playlist: HTTP ${response.status}`);
    }

    return await response.text();
  }

  // Playlist 파싱
  function parsePlaylist(playlistText) {
    const lines = playlistText.split('\n');
    const qualities = [];
    let currentQuality = null;

    for (const line of lines) {
      if (line.startsWith('#EXT-X-MEDIA:')) {
        const nameMatch = line.match(/NAME="([^"]+)"/);
        const groupMatch = line.match(/GROUP-ID="([^"]+)"/);
        if (nameMatch) {
          currentQuality = { name: nameMatch[1], group: groupMatch?.[1] };
        }
      } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const resMatch = line.match(/RESOLUTION=(\d+x\d+)/);
        const fpsMatch = line.match(/FRAME-RATE=([\d.]+)/);
        const bwMatch = line.match(/BANDWIDTH=(\d+)/);
        if (currentQuality) {
          currentQuality.resolution = resMatch?.[1];
          currentQuality.fps = fpsMatch?.[1];
          currentQuality.bandwidth = bwMatch?.[1];
        }
      } else if (line.startsWith('http') && currentQuality) {
        currentQuality.url = line.trim();
        qualities.push(currentQuality);
        currentQuality = null;
      }
    }

    return qualities;
  }

  // 스트림 정보 가져오기
  async function getStreamInfo(channel) {
    console.log('[Player] Getting stream info for:', channel);

    let tokenData = null;
    let usedPlayerType = 'embed';

    for (const playerType of AD_FREE_PLAYER_TYPES) {
      try {
        console.log('[Player] Trying playerType:', playerType);
        tokenData = await getAccessToken(channel, playerType);
        usedPlayerType = playerType;

        const tokenValue = JSON.parse(tokenData.value);
        if (!tokenValue.ads) {
          console.log('[Player] Found ad-free token with playerType:', playerType);
          break;
        }
      } catch (e) {
        console.warn('[Player] Failed with playerType', playerType, ':', e.message);
        continue;
      }
    }

    if (!tokenData) {
      throw new Error('Failed to get access token with any playerType');
    }

    const token = tokenData.value;
    const sig = tokenData.signature;

    console.log('[Player] Got token with playerType:', usedPlayerType);

    const playlistText = await getPlaylist(channel, token, sig);
    console.log('[Player] Playlist received, length:', playlistText.length);

    const qualities = parsePlaylist(playlistText);

    if (qualities.length === 0) {
      throw new Error('No qualities found in playlist');
    }

    console.log('[Player] Parsed qualities:', qualities.length);

    return { channel, qualities, playlist: playlistText };
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
    sidebar: () => document.getElementById('sidebar'),
    app: () => document.querySelector('.app'),
    chatSandbox: () => document.getElementById('chat-sandbox'),
    chatContainer: () => document.getElementById('chat-container'),
    popoutChatBtn: () => document.getElementById('popout-chat'),
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
      fLoader: createAdFilterLoader(Hls.DefaultConfig.loader),
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

  // 커스텀 Fragment Loader (광고 세그먼트 필터링)
  function createAdFilterLoader(DefaultLoader) {
    return class AdFilterLoader extends DefaultLoader {
      load(context, config, callbacks) {
        const url = context.url;

        if (url && (
          url.includes('stitched-ad') ||
          url.includes('advertisement') ||
          url.includes('/ad/') ||
          url.includes('amazon-adsystem')
        )) {
          console.log('[Player] Blocking ad segment:', url.substring(0, 80) + '...');
          adDetected = true;

          callbacks.onSuccess({
            data: new ArrayBuffer(0),
            url: url,
          }, context.stats, context);
          return;
        }

        super.load(context, config, callbacks);
      }
    };
  }

  // HLS 이벤트 설정
  function setupHlsEvents(hlsInstance) {
    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      console.error('[Player] HLS error:', data);

      if (adDetected && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        console.log('[Player] Network error during ad skip, ignoring');
        adDetected = false;
        return;
      }

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

  // ========== 채팅 sandbox iframe 설정 ==========

  // Twitch 채팅을 sandbox iframe으로 로드
  function loadChatEmbed(channel) {
    const chatSandbox = elements.chatSandbox();

    if (!chatSandbox) {
      console.warn('[Chat] Chat sandbox not found');
      return;
    }

    // sandbox 페이지에 채널 정보를 URL 파라미터로 전달
    const sandboxUrl = chrome.runtime.getURL(`chat-sandbox.html?channel=${channel}`);

    console.log('[Chat] Loading chat via sandbox iframe:', channel);

    // sandbox iframe src 설정
    chatSandbox.src = sandboxUrl;
  }

  // 채팅 새로고침
  function refreshChat() {
    const chatSandbox = elements.chatSandbox();

    if (chatSandbox && currentChannel) {
      console.log('[Chat] Refreshing chat');
      // postMessage로 새로고침 요청
      chatSandbox.contentWindow.postMessage({ type: 'refreshChat' }, '*');
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

      // 채팅 object 태그로 로드
      loadChatEmbed(channel);

      // 1080p 확인 및 통계
      const has1080p = qualities.some(q => q.name.includes('1080') || q.resolution?.includes('1920'));
      if (has1080p) {
        console.log('[Player] ✓ 1080p quality available!');
        chrome.runtime.sendMessage({ type: 'BYPASS_SUCCESS', platform: 'twitch' });
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
        fLoader: createAdFilterLoader(Hls.DefaultConfig.loader),
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

    await loadSettings();

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
