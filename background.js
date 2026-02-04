// Stream Quality Bypass - Background Service Worker

const DEFAULT_SETTINGS = {
  twitch: {
    enabled: true,
    proxyUrl: '',
    preferredQuality: '1080p',
    cdnNode: 'auto' // auto, akamai_korea, limelight_kt, limelight_sk, limelight_lg
  },
  chzzk: {
    enabled: true,
    disableGrid: true,
    preferredQuality: '1080p'
  }
};

// CDN 타입 정의
const CDN_TYPES = {
  kt: 'limelight_kt',
  skb: 'limelight_sk',
  lg: 'limelight_lg',
  others: 'akamai_korea'
};

// 현재 CDN 감지 (ISP 기반)
async function detectCDN() {
  try {
    const response = await fetch('https://ipinfo.io/json');
    const data = await response.json();
    const org = data.org || '';

    if (org.includes('4766') || org.toLowerCase().includes('kt')) {
      return CDN_TYPES.kt;
    } else if (org.includes('9318') || org.toLowerCase().includes('sk')) {
      return CDN_TYPES.skb;
    } else if (org.includes('3786') || org.toLowerCase().includes('lg')) {
      return CDN_TYPES.lg;
    }
    return CDN_TYPES.others;
  } catch (e) {
    console.error('[StreamBypass] CDN detection failed:', e);
    return CDN_TYPES.others;
  }
}

// 설정 가져오기
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings || DEFAULT_SETTINGS;
}

// Twitch 우회 규칙 활성화
async function enableTwitchBypass() {
  const settings = await getSettings();
  let cdnNode = settings.twitch?.cdnNode || 'auto';

  if (cdnNode === 'auto') {
    cdnNode = await detectCDN();
  }

  console.log('[StreamBypass] Enabling Twitch bypass with CDN:', cdnNode);

  // 기존 규칙 제거
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1001, 1002]
  });

  // 새 규칙 추가
  const rules = [
    // 규칙 1: X-Forwarded-For 헤더 추가
    {
      id: 1001,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          {
            header: 'X-Forwarded-For',
            operation: 'set',
            value: '::1'
          }
        ]
      },
      condition: {
        urlFilter: '*://usher.ttvnw.net/api/channel/hls/*',
        resourceTypes: ['xmlhttprequest']
      }
    },
    // 규칙 2: CDN 노드 강제 지정 (리다이렉트)
    {
      id: 1002,
      priority: 2,
      action: {
        type: 'redirect',
        redirect: {
          transform: {
            queryTransform: {
              addOrReplaceParams: [
                { key: 'force_segment_node', value: cdnNode },
                { key: 'force_manifest_node', value: 'video-weaver.sel03' }
              ]
            }
          }
        }
      },
      condition: {
        urlFilter: '*://usher.ttvnw.net/api/channel/hls/*',
        resourceTypes: ['xmlhttprequest']
      }
    }
  ];

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: rules
    });
    console.log('[StreamBypass] Twitch bypass rules enabled');
  } catch (e) {
    console.error('[StreamBypass] Failed to enable rules:', e);
  }
}

// Twitch 우회 규칙 비활성화
async function disableTwitchBypass() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1001, 1002]
  });
  console.log('[StreamBypass] Twitch bypass rules disabled');
}

// 설정 초기화
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get('settings');
  if (!stored.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
  console.log('[StreamBypass] Extension installed');

  // 초기 규칙 설정
  const settings = stored.settings || DEFAULT_SETTINGS;
  if (settings.twitch?.enabled) {
    await enableTwitchBypass();
  }
});

// 메시지 핸들러 (content script와 통신)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SETTINGS') {
    getSettings().then(settings => sendResponse(settings));
    return true; // 비동기 응답
  }

  if (message.type === 'UPDATE_SETTINGS') {
    chrome.storage.local.set({ settings: message.settings }).then(async () => {
      // Twitch 설정에 따라 규칙 업데이트
      if (message.settings.twitch?.enabled) {
        await enableTwitchBypass();
      } else {
        await disableTwitchBypass();
      }

      sendResponse({ success: true });

      // 모든 탭에 설정 변경 알림
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'SETTINGS_UPDATED',
            settings: message.settings
          }).catch(() => {});
        });
      });
    });
    return true;
  }

  if (message.type === 'ENABLE_TWITCH_BYPASS') {
    enableTwitchBypass().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'DISABLE_TWITCH_BYPASS') {
    disableTwitchBypass().then(() => sendResponse({ success: true }));
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

// 시작 시 규칙 활성화
(async () => {
  const settings = await getSettings();
  if (settings.twitch?.enabled) {
    await enableTwitchBypass();
  }
  console.log('[StreamBypass] Background service worker started');
})();
