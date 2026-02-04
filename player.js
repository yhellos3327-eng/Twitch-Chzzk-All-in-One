// Stream Bypass - Player Page Script

(function() {
  'use strict';

  let hls = null;
  let video = null;
  let settings = null;
  let currentChannel = null;
  let qualities = [];
  let currentQualityIndex = 0;

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

  // 스트림 정보 가져오기
  async function getStreamInfo(channel) {
    if (!settings?.twitch?.proxyUrl) {
      throw new Error('Proxy URL not set');
    }

    const proxyUrl = settings.twitch.proxyUrl.replace(/\/$/, '');
    const url = `${proxyUrl}/stream/${channel}`;

    const response = await fetch(url);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return await response.json();
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
    chatFrame: () => document.getElementById('chat-frame'),
    pipBtn: () => document.getElementById('pip-btn'),
    openTwitchBtn: () => document.getElementById('open-twitch'),
    toggleChatBtn: () => document.getElementById('toggle-chat'),
    sidebar: () => document.getElementById('sidebar'),
    app: () => document.querySelector('.app'),
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

    // 클릭 이벤트
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

    // 현재 재생 위치 저장
    const currentTime = video.currentTime;
    const wasPlaying = !video.paused;

    // HLS 소스 변경
    if (hls) {
      hls.destroy();
    }

    hls = new Hls({
      debug: false,
      enableWorker: true,
      lowLatencyMode: true,
    });

    hls.loadSource(quality.url);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (wasPlaying) {
        video.play();
      }
    });

    // UI 업데이트
    elements.currentQuality().textContent = quality.name;
    updateQualityMenu();

    // 뱃지 업데이트
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

      // 채팅 프레임 설정
      elements.chatFrame().src = `https://www.twitch.tv/embed/${channel}/chat?parent=${chrome.runtime.id}&darkpopout`;

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
      });

      // 최고 화질 선택
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

        // 뱃지 설정
        if (bestQuality.name.includes('1080') || bestQuality.resolution?.includes('1920')) {
          elements.qualityBadge().textContent = '1080p';
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('[Player] HLS error:', data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('[Player] Network error, trying to recover...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('[Player] Media error, trying to recover...');
              hls.recoverMediaError();
              break;
            default:
              showError('Fatal playback error. Try refreshing.');
              break;
          }
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

    if (!settings?.twitch?.proxyUrl) {
      showError('Proxy URL not set. Please configure in extension settings.');
      return;
    }

    setupControls();
    startStream(currentChannel);
  }

  // 페이지 로드 시 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
