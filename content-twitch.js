// Stream Quality Bypass - Twitch Click Interceptor
// 트위치 페이지에서 클릭을 가로채서 확장 프로그램 플레이어로 전송

(function () {
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

  // 예외 경로 목록
  const EXCLUDED_PATHS = [
    'directory', 'videos', 'settings', 'subscriptions', 'inventory',
    'drops', 'wallet', 'search', 'downloads', 'turbo', 'prime', 'bits',
    'following', 'browse', 'category', 'game', 'all', 'tags', 'p', 'u'
  ];

  // 채널명 추출 함수들
  function extractChannelFromHref(href) {
    if (!href) return null;

    // 디렉토리/카테고리 링크 무시
    if (href.includes('/directory/') || href.includes('/category/')) {
      return null;
    }

    // 상대 경로: /channelname 또는 /channelname?...
    const relativeMatch = href.match(/^\/([a-zA-Z0-9_]+)(?:\?|\/|$)/);
    if (relativeMatch) {
      const name = relativeMatch[1].toLowerCase();
      // 예외 경로 제외
      if (!EXCLUDED_PATHS.includes(name) && name.length > 1) {
        return name;
      }
    }

    // 절대 경로: https://www.twitch.tv/channelname
    try {
      const url = new URL(href, window.location.origin);
      if (url.hostname.includes('twitch.tv')) {
        const pathMatch = url.pathname.match(/^\/([a-zA-Z0-9_]+)(?:\/|$)/);
        if (pathMatch) {
          const name = pathMatch[1].toLowerCase();
          if (!EXCLUDED_PATHS.includes(name) && name.length > 1) {
            return name;
          }
        }
      }
    } catch (e) { }

    return null;
  }

  // 요소에서 채널명 찾기
  function findChannelFromElement(element) {
    // 1. 직접 href 확인
    if (element.href) {
      const channel = extractChannelFromHref(element.href);
      if (channel) return channel;
    }

    // 2. 부모 요소에서 링크 찾기
    const link = element.closest('a[href]');
    if (link) {
      const channel = extractChannelFromHref(link.href);
      if (channel) return channel;
    }

    // 3. 내부 링크 찾기
    const innerLink = element.querySelector('a[href]');
    if (innerLink) {
      const channel = extractChannelFromHref(innerLink.href);
      if (channel) return channel;
    }

    // 4. data 속성에서 찾기
    const dataChannel = element.getAttribute('data-a-id') ||
      element.getAttribute('data-test-selector')?.match(/([a-zA-Z0-9_]+)/)?.[1];
    if (dataChannel) {
      return dataChannel.toLowerCase();
    }

    // 5. 텍스트에서 채널명 추출 시도 (사이드바용)
    const titleEl = element.querySelector('[data-a-target="side-nav-title"]') ||
      element.querySelector('[class*="CoreText"]') ||
      element.querySelector('p');
    if (titleEl) {
      const text = titleEl.textContent?.trim();
      if (text && /^[a-zA-Z0-9_]+$/.test(text)) {
        return text.toLowerCase();
      }
    }

    return null;
  }

  // 플레이어 페이지 열기
  let isOpening = false;

  function openPlayer(channel) {
    if (!channel) {
      console.warn(LOG_PREFIX, 'No channel name to open');
      return;
    }

    if (isOpening) {
      console.log(LOG_PREFIX, 'Player open throttled');
      return;
    }
    isOpening = true;
    setTimeout(() => { isOpening = false; }, 1000);

    console.log(LOG_PREFIX, 'Opening player for:', channel);

    try {
      // 프록시 서버의 player 페이지 사용 (채팅 iframe 임베드 가능)
      const proxyUrl = settings?.twitch?.proxyUrl || 'https://rotten-kore-twitch-chzzk-all-in-one-6d9b3001.koyeb.app';
      const playerUrl = `${proxyUrl}?channel=${encodeURIComponent(channel)}`;

      // 팝업 창으로 열기 (크기 지정) 또는 새 탭
      // window.open(playerUrl, '_blank'); 
      // 사용자 경험을 위해 팝업으로 열거나 새 탭으로 열기 선택 가능하게 하면 좋음. 일단 새 탭 유지.
      window.open(playerUrl, '_blank');

    } catch (e) {
      // Extension context invalidated - 페이지 새로고침 필요
      console.warn(LOG_PREFIX, 'Extension context invalidated, please refresh the page');
      alert('확장 프로그램이 업데이트되었습니다. 페이지를 새로고침해주세요.');
    }
  }

  // 스트림 카드 클릭 핸들러
  function handleStreamCardClick(event) {
    if (!settings?.twitch?.enabled) return;

    const target = event.target;

    // 태그나 특정 UI 요소 클릭 시 무시 (먼저 체크)
    if (target.closest('[class*="ScTagContent"]') ||
      target.closest('[class*="tw-title"]') ||
      target.closest('[class*="StreamTagButton"]') ||
      target.closest('[data-a-target="preview-card-titles"]') ||
      target.closest('[data-a-target="preview-card-channel-link"]')) {
      console.log(LOG_PREFIX, 'Ignored click on title/tag');
      return;
    }

    // 디렉토리 페이지의 Layout-sc-* 요소 (스트림 카드 컨테이너)
    const layoutCard = target.closest('[class*="Layout-sc-"]');

    // 클릭된 요소가 스트림 카드인지 확인
    const streamCard = target.closest('.directory-first-item') ||
      target.closest('[data-a-target="preview-card-image-link"]') ||
      target.closest('[class*="PreviewCard"]') ||
      target.closest('article[class*="Layout"]') ||
      target.closest('div[data-target="directory-first-item"]') ||
      layoutCard;

    if (streamCard) {
      // Layout-sc-* 내부에서 채널 링크 찾기
      let channel = null;

      // 1. 카드 내부의 채널 링크에서 추출
      const channelLink = streamCard.querySelector('a[href*="/"][data-a-target="preview-card-channel-link"]') ||
        streamCard.querySelector('a[href*="/"][data-a-target="preview-card-image-link"]') ||
        streamCard.querySelector('a[href^="/"]');

      if (channelLink) {
        channel = extractChannelFromHref(channelLink.getAttribute('href'));
      }

      // 2. 일반적인 방법으로 찾기
      if (!channel) {
        channel = findChannelFromElement(streamCard);
      }

      // 3. 부모 요소에서 찾기 (Layout-sc-* 가 중첩된 경우)
      if (!channel && layoutCard) {
        const parentCard = layoutCard.parentElement?.closest('[class*="Layout-sc-"]');
        if (parentCard) {
          const parentLink = parentCard.querySelector('a[href^="/"]');
          if (parentLink) {
            channel = extractChannelFromHref(parentLink.getAttribute('href'));
          }
        }
      }

      // 채널명이 유효하고, 예외 경로가 아닌 경우에만 오픈
      if (channel && channel !== 'directory' && !channel.includes('/') && channel !== 'category') {
        console.log(LOG_PREFIX, 'Stream card clicked:', channel);
        event.preventDefault();
        event.stopPropagation();
        openPlayer(channel);
        return;
      }
    }
  }

  // 사이드바 클릭 핸들러
  function handleSidebarClick(event) {
    if (!settings?.twitch?.enabled) return;

    const target = event.target;

    // 사이드바 요소 확인
    const sidebarItem = target.closest('[data-a-target="side-nav-card"]') ||
      target.closest('[class*="side-nav-card"]') ||
      target.closest('[data-test-selector="followed-channel"]') ||
      target.closest('.tw-transition-group a[href]') ||
      target.closest('[data-a-id]');

    // 사이드바 내부 확인
    const isInSidebar = target.closest('#side-nav') ||
      target.closest('[class*="side-nav"]') ||
      target.closest('[data-a-target="side-nav"]');

    if (sidebarItem && isInSidebar) {
      const channel = findChannelFromElement(sidebarItem);
      if (channel) {
        console.log(LOG_PREFIX, 'Sidebar item clicked:', channel);
        event.preventDefault();
        event.stopPropagation();
        openPlayer(channel);
        return;
      }
    }
  }

  // 전역 클릭 핸들러
  function handleGlobalClick(event) {
    if (!settings?.twitch?.enabled) return;

    const target = event.target;

    // 제외할 요소 클릭 시 무시
    if (target.closest('[class*="ScTagContent"]') || // 태그
      target.closest('[class*="StreamTagButton"]') || // 스트림 태그 버튼
      target.closest('[class*="tw-image-avatar"]') || // 프로필 이미지
      target.closest('[data-test-selector="top-nav__browse-link"]') || // 탐색 링크
      target.closest('[aria-label="탐색"]') || // 탐색 라벨
      target.closest('[data-a-target="followed-channel"]') === null && target.closest('[class*="ChannelStatusTextIndicator"]') || // 채널 상태 텍스트
      target.closest('nav') || // 네비게이션 바
      target.closest('[data-a-target="top-nav-container"]')) { // 상단 네비게이션
      console.log(LOG_PREFIX, 'Click ignored due to exclude selector');
      return;
    }

    // 스트림 카드 처리
    handleStreamCardClick(event);

    // 사이드바 처리
    handleSidebarClick(event);
  }

  // 특정 영역에 이벤트 리스너 설정
  function setupInterceptors() {
    // 캡처 단계에서 클릭 이벤트 가로채기
    document.addEventListener('click', handleGlobalClick, true);

    console.log(LOG_PREFIX, 'Click interceptors set up');
  }

  // 현재 페이지가 채널 페이지인지 확인하고 리다이렉트
  function checkCurrentPage() {
    if (!settings?.twitch?.enabled) return;

    const path = window.location.pathname;
    const match = path.match(/^\/([a-zA-Z0-9_]+)(?:\/)?$/);

    if (match) {
      const channel = match[1].toLowerCase();
      const excluded = ['directory', 'videos', 'settings', 'subscriptions', 'inventory', 'drops', 'wallet', 'search', 'downloads', 'turbo', 'prime', 'bits', 'following', 'browse'];

      if (!excluded.includes(channel)) {
        // 이미 플레이어 페이지에서 열렸을 경우 중복 방지
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('bypass') === 'no') {
          console.log(LOG_PREFIX, 'Bypass disabled for this page');
          return;
        }

        console.log(LOG_PREFIX, 'Direct channel page detected:', channel);

        // 사용자에게 확인 없이 바로 열지 않고, 바이패스 버튼 추가
        addBypassButton(channel);
      }
    }
  }

  // 바이패스 버튼 추가 (채널 페이지용)
  function addBypassButton(channel) {
    // 이미 버튼이 있으면 스킵
    if (document.getElementById('stream-bypass-btn')) return;

    const button = document.createElement('button');
    button.id = 'stream-bypass-btn';
    button.innerHTML = '🎬 1080p 플레이어';
    button.style.cssText = `
      position: fixed;
      top: 70px;
      right: 20px;
      z-index: 99999;
      background: linear-gradient(135deg, #9147ff, #6441a5);
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(145, 71, 255, 0.4);
      transition: all 0.3s ease;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.transform = 'scale(1.05)';
      button.style.boxShadow = '0 6px 20px rgba(145, 71, 255, 0.6)';
    });

    button.addEventListener('mouseleave', () => {
      button.style.transform = 'scale(1)';
      button.style.boxShadow = '0 4px 15px rgba(145, 71, 255, 0.4)';
    });

    button.addEventListener('click', () => {
      openPlayer(channel);
    });

    document.body.appendChild(button);
    console.log(LOG_PREFIX, 'Bypass button added for:', channel);
  }

  // 페이지 변경 감지 (SPA 대응)
  function observePageChanges() {
    let lastUrl = location.href;

    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        console.log(LOG_PREFIX, 'Page changed:', lastUrl);

        // 기존 버튼 제거
        const existingBtn = document.getElementById('stream-bypass-btn');
        if (existingBtn) existingBtn.remove();

        // 새 페이지 확인
        setTimeout(checkCurrentPage, 1000);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // 설정 업데이트 수신
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SETTINGS_UPDATED') {
      settings = message.settings;
      console.log(LOG_PREFIX, 'Settings updated');

      // 바이패스 버튼 토글
      const btn = document.getElementById('stream-bypass-btn');
      if (settings?.twitch?.enabled) {
        if (!btn) checkCurrentPage();
      } else {
        if (btn) btn.remove();
      }
    }
  });

  // 초기화
  async function init() {
    console.log(LOG_PREFIX, 'Initializing click interceptor...');

    await loadSettings();

    if (settings?.twitch?.enabled) {
      setupInterceptors();
      observePageChanges();

      // 약간 지연 후 현재 페이지 확인
      setTimeout(checkCurrentPage, 1500);
    }

    console.log(LOG_PREFIX, 'Initialized');
  }

  // 페이지 로드 시 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
