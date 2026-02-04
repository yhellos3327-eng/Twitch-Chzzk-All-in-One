// Stream Quality Bypass - Background Service Worker

const DEFAULT_SETTINGS = {
  twitch: {
    enabled: true,
    proxyUrl: '',
    preferredQuality: '1080p'
  },
  chzzk: {
    enabled: true,
    disableGrid: true,
    preferredQuality: '1080p'
  }
};

// 설정 초기화
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get('settings');
  if (!stored.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
  console.log('[StreamBypass] Extension installed');
});

// 설정 가져오기
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings || DEFAULT_SETTINGS;
}

// Twitch playlist 요청 감지 및 처리
chrome.webRequest?.onBeforeRequest.addListener(
  async (details) => {
    const settings = await getSettings();

    if (!settings.twitch.enabled) return;

    // Twitch HLS playlist 요청 감지
    if (details.url.includes('usher.ttvnw.net') && details.url.includes('.m3u8')) {
      console.log('[StreamBypass] Twitch playlist request detected:', details.url);

      // 프록시 URL이 설정되어 있으면 리다이렉트
      if (settings.twitch.proxyUrl) {
        const proxyUrl = `${settings.twitch.proxyUrl}?url=${encodeURIComponent(details.url)}`;
        return { redirectUrl: proxyUrl };
      }
    }
  },
  { urls: ['*://*.ttvnw.net/*'] },
  ['blocking']
);

// 메시지 핸들러 (content script와 통신)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SETTINGS') {
    getSettings().then(settings => sendResponse(settings));
    return true; // 비동기 응답
  }

  if (message.type === 'UPDATE_SETTINGS') {
    chrome.storage.local.set({ settings: message.settings }).then(() => {
      sendResponse({ success: true });
      // 모든 탭에 설정 변경 알림
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED', settings: message.settings }).catch(() => {});
        });
      });
    });
    return true;
  }

  if (message.type === 'LOG') {
    console.log(`[StreamBypass:${message.source}]`, message.data);
  }
});

// 통계 추적
let stats = {
  twitch: { bypassed: 0, lastBypass: null },
  chzzk: { bypassed: 0, lastBypass: null }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BYPASS_SUCCESS') {
    stats[message.platform].bypassed++;
    stats[message.platform].lastBypass = Date.now();
    console.log(`[StreamBypass] ${message.platform} bypass count:`, stats[message.platform].bypassed);
  }

  if (message.type === 'GET_STATS') {
    sendResponse(stats);
    return true;
  }
});

console.log('[StreamBypass] Background service worker started');
