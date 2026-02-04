// Stream Quality Bypass - Chzzk Content Script

(function() {
  'use strict';

  const LOG_PREFIX = '[StreamBypass:Chzzk]';
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

  // 네이버 그리드 (P2P) 비활성화
  function disableNaverGrid() {
    // 그리드 관련 전역 객체 무력화
    Object.defineProperty(window, 'NaverMediaGrid', {
      get: () => undefined,
      set: () => {},
      configurable: false
    });

    Object.defineProperty(window, 'NMGrid', {
      get: () => undefined,
      set: () => {},
      configurable: false
    });

    // 그리드 SDK 로딩 차단
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = function(tagName) {
      const element = originalCreateElement(tagName);

      if (tagName.toLowerCase() === 'script') {
        const originalSetAttribute = element.setAttribute.bind(element);
        element.setAttribute = function(name, value) {
          if (name === 'src' && value && (value.includes('grid') || value.includes('nmgrid'))) {
            console.log(LOG_PREFIX, 'Blocked grid script:', value);
            return; // 그리드 스크립트 로딩 차단
          }
          return originalSetAttribute(name, value);
        };

        // src 프로퍼티도 감시
        Object.defineProperty(element, 'src', {
          set: function(value) {
            if (value && (value.includes('grid') || value.includes('nmgrid'))) {
              console.log(LOG_PREFIX, 'Blocked grid script (src):', value);
              return;
            }
            element.setAttribute('src', value);
          },
          get: function() {
            return element.getAttribute('src');
          }
        });
      }

      return element;
    };

    console.log(LOG_PREFIX, 'Grid disabled');
  }

  // Fetch API 가로채기 - 그리드 관련 요청 차단 및 직접 연결 강제
  function interceptFetch() {
    const originalFetch = window.fetch;

    window.fetch = async function(input, init) {
      const url = typeof input === 'string' ? input : input.url;

      // 그리드 관련 요청 차단
      if (url.includes('grid') || url.includes('nmgrid') || url.includes('p2p')) {
        console.log(LOG_PREFIX, 'Blocked grid request:', url);
        return new Response(null, { status: 204 });
      }

      // HLS playlist 요청 감지
      if (url.includes('.m3u8') && (url.includes('chzzk') || url.includes('naver'))) {
        console.log(LOG_PREFIX, 'Playlist request:', url);

        const response = await originalFetch.apply(this, arguments);

        if (response.ok) {
          chrome.runtime.sendMessage({ type: 'BYPASS_SUCCESS', platform: 'chzzk' });
        }

        return response;
      }

      return originalFetch.apply(this, arguments);
    };
  }

  // WebSocket 가로채기 - 그리드 P2P 연결 차단
  function interceptWebSocket() {
    const OriginalWebSocket = window.WebSocket;

    window.WebSocket = function(url, protocols) {
      // 그리드 관련 WebSocket 차단
      if (url.includes('grid') || url.includes('p2p') || url.includes('nmgrid')) {
        console.log(LOG_PREFIX, 'Blocked grid WebSocket:', url);
        // 더미 WebSocket 반환 (연결 안 됨)
        const dummy = {
          readyState: 3, // CLOSED
          send: () => {},
          close: () => {},
          addEventListener: () => {},
          removeEventListener: () => {}
        };
        return dummy;
      }

      return new OriginalWebSocket(url, protocols);
    };

    window.WebSocket.prototype = OriginalWebSocket.prototype;
    window.WebSocket.CONNECTING = 0;
    window.WebSocket.OPEN = 1;
    window.WebSocket.CLOSING = 2;
    window.WebSocket.CLOSED = 3;
  }

  // RTCPeerConnection 차단 (P2P 완전 비활성화)
  function disableWebRTC() {
    window.RTCPeerConnection = function() {
      console.log(LOG_PREFIX, 'Blocked RTCPeerConnection');
      throw new Error('RTCPeerConnection is disabled');
    };

    window.webkitRTCPeerConnection = window.RTCPeerConnection;
    window.mozRTCPeerConnection = window.RTCPeerConnection;
  }

  // 화질 선택 UI 감시 및 자동 선택
  function watchQualitySelector() {
    const observer = new MutationObserver((mutations) => {
      // 치지직 화질 선택 버튼 찾기
      const qualityItems = document.querySelectorAll('[class*="quality"]');
      if (qualityItems.length > 0 && settings?.chzzk?.preferredQuality) {
        console.log(LOG_PREFIX, 'Quality selector found');
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // LocalStorage에서 그리드 설정 제거
  function cleanLocalStorage() {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.includes('grid') || key.includes('p2p'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
      console.log(LOG_PREFIX, 'Removed localStorage key:', key);
    });
  }

  // 초기화
  async function init() {
    console.log(LOG_PREFIX, 'Initializing...');

    await loadSettings();

    if (settings?.chzzk?.enabled) {
      if (settings?.chzzk?.disableGrid) {
        disableNaverGrid();
        disableWebRTC();
        interceptWebSocket();
        cleanLocalStorage();
      }
      interceptFetch();
      watchQualitySelector();
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

  // 페이지 로드 전에 그리드 차단 (가장 빠르게)
  if (settings?.chzzk?.disableGrid !== false) {
    disableNaverGrid();
  }

  // 나머지 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
