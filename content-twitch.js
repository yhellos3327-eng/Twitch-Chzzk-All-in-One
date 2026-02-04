// Stream Quality Bypass - Twitch Content Script

(function() {
  'use strict';

  const LOG_PREFIX = '[StreamBypass:Twitch]';
  let settings = null;

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

  // Worker 스크립트 가로채기 (Twitch 플레이어 조작용)
  function interceptWorker() {
    const originalWorker = window.Worker;

    window.Worker = function(url, options) {
      console.log(LOG_PREFIX, 'Worker created:', url);
      return new originalWorker(url, options);
    };

    window.Worker.prototype = originalWorker.prototype;
  }

  // Fetch API 가로채기 - playlist 요청 수정
  function interceptFetch() {
    const originalFetch = window.fetch;

    window.fetch = async function(input, init) {
      const url = typeof input === 'string' ? input : input.url;

      // Twitch playlist 요청 감지
      if (url.includes('usher.ttvnw.net') && url.includes('.m3u8')) {
        console.log(LOG_PREFIX, 'Playlist request intercepted:', url);

        if (settings?.twitch?.enabled && settings?.twitch?.proxyUrl) {
          // 프록시를 통해 요청
          const baseProxy = settings.twitch.proxyUrl.replace(/\/$/, '');
          const proxyUrl = `${baseProxy}/proxy?url=${encodeURIComponent(url)}`;
          console.log(LOG_PREFIX, 'Redirecting to proxy:', proxyUrl);

          try {
            const response = await originalFetch(proxyUrl, init);
            if (response.ok) {
              chrome.runtime.sendMessage({ type: 'BYPASS_SUCCESS', platform: 'twitch' });
              return response;
            }
          } catch (e) {
            console.warn(LOG_PREFIX, 'Proxy request failed, falling back:', e);
          }
        }
      }

      // 일반 요청은 그대로 진행
      return originalFetch.apply(this, arguments);
    };
  }

  // XMLHttpRequest 가로채기 (레거시 지원)
  function interceptXHR() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this._url = url;
      return originalOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function(body) {
      if (this._url && this._url.includes('usher.ttvnw.net') && this._url.includes('.m3u8')) {
        console.log(LOG_PREFIX, 'XHR playlist request:', this._url);
      }
      return originalSend.apply(this, arguments);
    };
  }

  // 화질 선택 강제 (플레이어 설정 조작)
  function forceQualitySelection() {
    // Twitch 플레이어가 로드된 후 화질 설정
    const observer = new MutationObserver((mutations) => {
      const qualityButton = document.querySelector('[data-a-target="player-settings-button"]');
      if (qualityButton && settings?.twitch?.preferredQuality) {
        // 화질 메뉴가 있는지 확인
        console.log(LOG_PREFIX, 'Player settings button found');
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // 초기화
  async function init() {
    console.log(LOG_PREFIX, 'Initializing...');

    await loadSettings();

    if (settings?.twitch?.enabled) {
      interceptFetch();
      interceptXHR();
      interceptWorker();
      forceQualitySelection();
      console.log(LOG_PREFIX, 'Bypass active');
    } else {
      console.log(LOG_PREFIX, 'Bypass disabled');
    }
  }

  // 설정 업데이트 수신
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SETTINGS_UPDATED') {
      settings = message.settings;
      console.log(LOG_PREFIX, 'Settings updated:', settings);
    }
  });

  // 페이지 로드 시 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
