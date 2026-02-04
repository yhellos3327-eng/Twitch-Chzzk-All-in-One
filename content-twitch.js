// Stream Quality Bypass - Twitch Custom Player

(function() {
  'use strict';

  const LOG_PREFIX = '[StreamBypass:Twitch]';
  let settings = null;
  let currentChannel = null;
  let customPlayer = null;
  let hls = null;
  let qualities = [];
  let isPlayerActive = false;

  // 설정 로드
  async function loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      settings = response;
      console.log(LOG_PREFIX, 'Settings loaded:', settings);
    } catch (e) {
      console.error(LOG_PREFIX, 'Failed to load settings:', e);
    }
  }

  // 현재 채널명 추출
  function getCurrentChannel() {
    const match = window.location.pathname.match(/^\/([a-zA-Z0-9_]+)/);
    if (match && !['directory', 'videos', 'settings', 'subscriptions', 'inventory', 'drops', 'wallet'].includes(match[1])) {
      return match[1].toLowerCase();
    }
    return null;
  }

  // hls.js 로드
  function loadHlsJs() {
    return new Promise((resolve, reject) => {
      if (window.Hls) {
        resolve(window.Hls);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
      script.onload = () => resolve(window.Hls);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // 스트림 정보 가져오기 (프록시 경유)
  async function getStreamInfo(channel) {
    if (!settings?.twitch?.proxyUrl) {
      console.error(LOG_PREFIX, 'Proxy URL not set');
      return null;
    }

    const proxyUrl = settings.twitch.proxyUrl.replace(/\/$/, '');
    const url = `${proxyUrl}/stream/${channel}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (e) {
      console.error(LOG_PREFIX, 'Failed to get stream info:', e);
      return null;
    }
  }

  // 커스텀 플레이어 생성
  function createCustomPlayer() {
    const container = document.createElement('div');
    container.id = 'stream-bypass-player';
    container.innerHTML = `
      <style>
        #stream-bypass-player {
          position: relative;
          width: 100%;
          height: 100%;
          background: #000;
          z-index: 9999;
        }
        #stream-bypass-player video {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .sbp-controls {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          padding: 10px 15px;
          background: linear-gradient(transparent, rgba(0,0,0,0.8));
          display: flex;
          align-items: center;
          gap: 15px;
          opacity: 0;
          transition: opacity 0.3s;
        }
        #stream-bypass-player:hover .sbp-controls {
          opacity: 1;
        }
        .sbp-btn {
          background: none;
          border: none;
          color: white;
          cursor: pointer;
          padding: 5px 10px;
          font-size: 14px;
          border-radius: 4px;
          transition: background 0.2s;
        }
        .sbp-btn:hover {
          background: rgba(255,255,255,0.2);
        }
        .sbp-quality-selector {
          position: relative;
        }
        .sbp-quality-menu {
          position: absolute;
          bottom: 100%;
          right: 0;
          background: rgba(0,0,0,0.9);
          border-radius: 6px;
          padding: 5px 0;
          min-width: 150px;
          display: none;
        }
        .sbp-quality-menu.active {
          display: block;
        }
        .sbp-quality-item {
          padding: 8px 15px;
          cursor: pointer;
          font-size: 13px;
          color: #fff;
          transition: background 0.2s;
        }
        .sbp-quality-item:hover {
          background: rgba(255,255,255,0.1);
        }
        .sbp-quality-item.active {
          color: #a855f7;
          font-weight: bold;
        }
        .sbp-volume-slider {
          width: 80px;
          cursor: pointer;
        }
        .sbp-time {
          color: #fff;
          font-size: 12px;
          margin-left: auto;
        }
        .sbp-fullscreen {
          margin-left: 10px;
        }
        .sbp-loading {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: white;
          font-size: 16px;
        }
        .sbp-error {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: #ef4444;
          font-size: 16px;
          text-align: center;
        }
        .sbp-badge {
          position: absolute;
          top: 10px;
          left: 10px;
          background: linear-gradient(135deg, #a855f7, #6366f1);
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: bold;
          opacity: 0.8;
        }
      </style>
      <video id="sbp-video" playsinline></video>
      <div class="sbp-badge">1080p Bypass</div>
      <div class="sbp-loading" id="sbp-loading">Loading stream...</div>
      <div class="sbp-error" id="sbp-error" style="display:none;"></div>
      <div class="sbp-controls">
        <button class="sbp-btn" id="sbp-play-pause">▶️</button>
        <button class="sbp-btn" id="sbp-mute">🔊</button>
        <input type="range" class="sbp-volume-slider" id="sbp-volume" min="0" max="100" value="100">
        <div class="sbp-quality-selector">
          <button class="sbp-btn" id="sbp-quality-btn">⚙️ Quality</button>
          <div class="sbp-quality-menu" id="sbp-quality-menu"></div>
        </div>
        <span class="sbp-time" id="sbp-time">LIVE</span>
        <button class="sbp-btn sbp-fullscreen" id="sbp-fullscreen">⛶</button>
      </div>
    `;

    return container;
  }

  // 플레이어 컨트롤 설정
  function setupControls(video) {
    const playPauseBtn = document.getElementById('sbp-play-pause');
    const muteBtn = document.getElementById('sbp-mute');
    const volumeSlider = document.getElementById('sbp-volume');
    const qualityBtn = document.getElementById('sbp-quality-btn');
    const qualityMenu = document.getElementById('sbp-quality-menu');
    const fullscreenBtn = document.getElementById('sbp-fullscreen');
    const loading = document.getElementById('sbp-loading');

    // 재생/일시정지
    playPauseBtn.addEventListener('click', () => {
      if (video.paused) {
        video.play();
        playPauseBtn.textContent = '⏸️';
      } else {
        video.pause();
        playPauseBtn.textContent = '▶️';
      }
    });

    // 음소거
    muteBtn.addEventListener('click', () => {
      video.muted = !video.muted;
      muteBtn.textContent = video.muted ? '🔇' : '🔊';
    });

    // 볼륨
    volumeSlider.addEventListener('input', (e) => {
      video.volume = e.target.value / 100;
      video.muted = false;
      muteBtn.textContent = video.volume === 0 ? '🔇' : '🔊';
    });

    // 화질 메뉴 토글
    qualityBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      qualityMenu.classList.toggle('active');
    });

    document.addEventListener('click', () => {
      qualityMenu.classList.remove('active');
    });

    // 전체화면
    fullscreenBtn.addEventListener('click', () => {
      const player = document.getElementById('stream-bypass-player');
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        player.requestFullscreen();
      }
    });

    // 비디오 이벤트
    video.addEventListener('playing', () => {
      loading.style.display = 'none';
      playPauseBtn.textContent = '⏸️';
    });

    video.addEventListener('waiting', () => {
      loading.style.display = 'block';
      loading.textContent = 'Buffering...';
    });

    video.addEventListener('canplay', () => {
      loading.style.display = 'none';
    });

    // 더블클릭 전체화면
    video.addEventListener('dblclick', () => {
      fullscreenBtn.click();
    });

    // 클릭 재생/일시정지
    video.addEventListener('click', () => {
      playPauseBtn.click();
    });
  }

  // 화질 메뉴 업데이트
  function updateQualityMenu(qualities, currentLevel) {
    const menu = document.getElementById('sbp-quality-menu');
    if (!menu) return;

    menu.innerHTML = qualities.map((q, i) => `
      <div class="sbp-quality-item ${i === currentLevel ? 'active' : ''}" data-level="${i}">
        ${q.name} ${q.resolution ? `(${q.resolution})` : ''}
      </div>
    `).join('');

    // 화질 선택 이벤트
    menu.querySelectorAll('.sbp-quality-item').forEach(item => {
      item.addEventListener('click', () => {
        const level = parseInt(item.dataset.level);
        if (hls) {
          hls.currentLevel = level;
          updateQualityMenu(qualities, level);
        }
        menu.classList.remove('active');
      });
    });
  }

  // HLS 스트림 시작
  async function startStream(channel) {
    console.log(LOG_PREFIX, 'Starting stream for:', channel);

    const Hls = await loadHlsJs();

    if (!Hls.isSupported()) {
      showError('HLS is not supported in this browser');
      return;
    }

    const streamInfo = await getStreamInfo(channel);

    if (!streamInfo) {
      showError('Failed to load stream. Check proxy settings.');
      return;
    }

    if (!streamInfo.qualities || streamInfo.qualities.length === 0) {
      showError('Stream is offline or no qualities available');
      return;
    }

    console.log(LOG_PREFIX, 'Stream info:', streamInfo);
    qualities = streamInfo.qualities;

    // 1080p가 있는지 확인
    const has1080p = qualities.some(q => q.name.includes('1080') || q.resolution?.includes('1920'));
    if (has1080p) {
      console.log(LOG_PREFIX, '✓ 1080p quality available!');
      chrome.runtime.sendMessage({ type: 'BYPASS_SUCCESS', platform: 'twitch' });
    }

    const video = document.getElementById('sbp-video');

    // 기존 HLS 인스턴스 정리
    if (hls) {
      hls.destroy();
    }

    // 최고 화질 URL 선택 (첫 번째가 보통 최고 화질)
    const bestQuality = qualities[0];

    hls = new Hls({
      debug: false,
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 90,
    });

    hls.loadSource(bestQuality.url);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      console.log(LOG_PREFIX, 'Manifest parsed, starting playback');
      video.play().catch(e => {
        console.warn(LOG_PREFIX, 'Autoplay failed:', e);
      });
      updateQualityMenu(qualities, 0);
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      console.error(LOG_PREFIX, 'HLS error:', data);
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.log(LOG_PREFIX, 'Network error, trying to recover...');
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.log(LOG_PREFIX, 'Media error, trying to recover...');
            hls.recoverMediaError();
            break;
          default:
            showError('Fatal playback error');
            hls.destroy();
            break;
        }
      }
    });

    setupControls(video);
  }

  // 에러 표시
  function showError(message) {
    const loading = document.getElementById('sbp-loading');
    const error = document.getElementById('sbp-error');
    if (loading) loading.style.display = 'none';
    if (error) {
      error.style.display = 'block';
      error.textContent = message;
    }
  }

  // 원본 플레이어 교체
  function replacePlayer() {
    const channel = getCurrentChannel();
    if (!channel || channel === currentChannel) return;

    console.log(LOG_PREFIX, 'Channel detected:', channel);
    currentChannel = channel;

    // Twitch 원본 플레이어 찾기
    const originalPlayer = document.querySelector('[data-a-target="video-player"]') ||
                          document.querySelector('.video-player') ||
                          document.querySelector('[class*="video-player"]');

    if (!originalPlayer) {
      console.log(LOG_PREFIX, 'Original player not found, waiting...');
      return;
    }

    // 이미 교체됨
    if (document.getElementById('stream-bypass-player')) {
      return;
    }

    console.log(LOG_PREFIX, 'Replacing player...');

    // 커스텀 플레이어 생성 및 삽입
    customPlayer = createCustomPlayer();

    // 원본 플레이어 숨기고 커스텀 플레이어 삽입
    originalPlayer.style.display = 'none';
    originalPlayer.parentNode.insertBefore(customPlayer, originalPlayer);

    isPlayerActive = true;

    // 스트림 시작
    startStream(channel);
  }

  // 플레이어 복원
  function restorePlayer() {
    const originalPlayer = document.querySelector('[data-a-target="video-player"]') ||
                          document.querySelector('.video-player');
    const customPlayer = document.getElementById('stream-bypass-player');

    if (originalPlayer) {
      originalPlayer.style.display = '';
    }

    if (customPlayer) {
      customPlayer.remove();
    }

    if (hls) {
      hls.destroy();
      hls = null;
    }

    isPlayerActive = false;
    currentChannel = null;
  }

  // 페이지 변경 감지
  function observePageChanges() {
    let lastUrl = location.href;

    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        console.log(LOG_PREFIX, 'Page changed');

        // 플레이어 리셋
        if (hls) {
          hls.destroy();
          hls = null;
        }
        currentChannel = null;

        const existingPlayer = document.getElementById('stream-bypass-player');
        if (existingPlayer) {
          existingPlayer.remove();
        }

        // 새 채널 감지
        setTimeout(() => {
          if (settings?.twitch?.enabled) {
            replacePlayer();
          }
        }, 1000);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // 플레이어 요소 감지
    const playerObserver = new MutationObserver(() => {
      if (settings?.twitch?.enabled && !document.getElementById('stream-bypass-player')) {
        replacePlayer();
      }
    });

    playerObserver.observe(document.body, { childList: true, subtree: true });
  }

  // 초기화
  async function init() {
    console.log(LOG_PREFIX, 'Initializing custom player...');

    await loadSettings();

    if (settings?.twitch?.enabled && settings?.twitch?.proxyUrl) {
      console.log(LOG_PREFIX, 'Custom player mode active');

      // 약간 지연 후 플레이어 교체 시도
      setTimeout(() => {
        replacePlayer();
        observePageChanges();
      }, 2000);
    } else {
      console.log(LOG_PREFIX, 'Custom player disabled or proxy not set');
    }
  }

  // 설정 업데이트 수신
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SETTINGS_UPDATED') {
      settings = message.settings;
      console.log(LOG_PREFIX, 'Settings updated');

      if (settings?.twitch?.enabled && settings?.twitch?.proxyUrl) {
        if (!isPlayerActive) {
          replacePlayer();
        }
      } else {
        restorePlayer();
      }
    }
  });

  // 페이지 로드 시 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
