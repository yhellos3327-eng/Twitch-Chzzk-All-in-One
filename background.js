// Stream Quality Bypass - Background Service Worker
// ==================================================
// Tab Capture 관리, Offscreen Document 제어, 자막 라우팅

const DEFAULT_SETTINGS = {
  twitch: {
    enabled: true,
    proxyUrl: '',
    preferredQuality: '1080p',
    cdnNode: 'auto'
  },
  chzzk: {
    enabled: true,
    disableGrid: true,
    preferredQuality: '1080p'
  },
  subtitle: {
    enabled: false,
    sttEngine: 'deepgram',
    apiKey: '',
    language: 'ko'
  }
};

// CDN 타입 정의
const CDN_TYPES = {
  kt: 'limelight_kt',
  skb: 'limelight_sk',
  lg: 'limelight_lg',
  others: 'akamai_korea'
};

// Subtitle State
let subtitleState = {
  isActive: false,
  targetTabId: null
};

// ============================================
// CDN Detection
// ============================================
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

// ============================================
// Settings Management
// ============================================
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings || DEFAULT_SETTINGS;
}

// ============================================
// Twitch Bypass Rules
// ============================================
async function enableTwitchBypass() {
  const settings = await getSettings();
  let cdnNode = settings.twitch?.cdnNode || 'auto';

  if (cdnNode === 'auto') {
    cdnNode = await detectCDN();
  }

  console.log('[StreamBypass] Enabling Twitch bypass with CDN:', cdnNode);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1001, 1002]
  });

  const rules = [
    {
      id: 1001,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'X-Forwarded-For', operation: 'set', value: '::1' }
        ]
      },
      condition: {
        urlFilter: '*://usher.ttvnw.net/api/channel/hls/*',
        resourceTypes: ['xmlhttprequest']
      }
    },
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
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: rules });
    console.log('[StreamBypass] Twitch bypass rules enabled');
  } catch (e) {
    console.error('[StreamBypass] Failed to enable rules:', e);
  }
}

async function disableTwitchBypass() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1001, 1002]
  });
  console.log('[StreamBypass] Twitch bypass rules disabled');
}

// ============================================
// Offscreen Document Management
// ============================================
async function setupOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');

  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });

    if (existingContexts.length > 0) {
      console.log('[Offscreen] Document already exists');
      return true;
    }

    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
      justification: 'Capture tab audio for real-time speech-to-text with VAD processing'
    });

    console.log('[Offscreen] Document created');
    return true;

  } catch (e) {
    console.error('[Offscreen] Failed to create document:', e);
    return false;
  }
}

async function closeOffscreenDocument() {
  try {
    await chrome.offscreen.closeDocument();
    console.log('[Offscreen] Document closed');
  } catch (e) {
    // Document might not exist
  }
}

// ============================================
// Subtitle Control
// ============================================
async function startSubtitle(tabId) {
  if (subtitleState.isActive) {
    console.log('[Subtitle] Already active');
    return { success: false, error: 'Already active' };
  }

  const settings = await getSettings();
  const apiKey = settings.subtitle?.apiKey;
  const language = settings.subtitle?.language || 'ko';

  if (!apiKey) {
    return { success: false, error: 'API 키가 설정되지 않았습니다. 설정에서 Deepgram API 키를 입력해주세요.' };
  }

  try {
    // Offscreen Document 생성
    const offscreenReady = await setupOffscreenDocument();
    if (!offscreenReady) {
      return { success: false, error: 'Offscreen document 생성 실패' };
    }

    // Tab Capture Stream ID 획득
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId
    });

    if (!streamId) {
      return { success: false, error: 'Tab capture 실패' };
    }

    // Offscreen으로 캡처 시작 명령
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'start-capture',
      streamId: streamId,
      apiKey: apiKey,
      language: language
    });

    subtitleState.isActive = true;
    subtitleState.targetTabId = tabId;

    console.log('[Subtitle] Started for tab:', tabId);
    return { success: true };

  } catch (e) {
    console.error('[Subtitle] Start failed:', e);
    return { success: false, error: e.message };
  }
}

async function stopSubtitle() {
  if (!subtitleState.isActive) {
    return { success: true };
  }

  try {
    // Offscreen에 중지 명령
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'stop-capture'
    });

    subtitleState.isActive = false;
    subtitleState.targetTabId = null;

    // Offscreen Document 닫기 (선택적)
    // await closeOffscreenDocument();

    console.log('[Subtitle] Stopped');
    return { success: true };

  } catch (e) {
    console.error('[Subtitle] Stop failed:', e);
    subtitleState.isActive = false;
    return { success: false, error: e.message };
  }
}

// ============================================
// Message Handler
// ============================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Settings
  if (message.type === 'GET_SETTINGS') {
    getSettings().then(settings => sendResponse(settings));
    return true;
  }

  if (message.type === 'UPDATE_SETTINGS') {
    chrome.storage.local.set({ settings: message.settings }).then(async () => {
      if (message.settings.twitch?.enabled) {
        await enableTwitchBypass();
      } else {
        await disableTwitchBypass();
      }
      sendResponse({ success: true });

      // Broadcast to all tabs
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'SETTINGS_UPDATED',
            settings: message.settings
          }).catch(() => { });
        });
      });
    });
    return true;
  }

  // Twitch Bypass
  if (message.type === 'ENABLE_TWITCH_BYPASS') {
    enableTwitchBypass().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'DISABLE_TWITCH_BYPASS') {
    disableTwitchBypass().then(() => sendResponse({ success: true }));
    return true;
  }

  // Subtitle Control
  if (message.type === 'START_SUBTITLE') {
    const tabId = message.tabId || sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab ID' });
      return true;
    }
    startSubtitle(tabId).then(result => sendResponse(result));
    return true;
  }

  if (message.type === 'STOP_SUBTITLE') {
    stopSubtitle().then(result => sendResponse(result));
    return true;
  }

  if (message.type === 'GET_SUBTITLE_STATUS') {
    sendResponse({
      isActive: subtitleState.isActive,
      targetTabId: subtitleState.targetTabId
    });
    return true;
  }

  // Subtitle Events (from Offscreen)
  if (message.type === 'subtitle-event') {
    handleSubtitleEvent(message);
  }

  // Legacy support
  if (message.type === 'subtitle-result') {
    forwardToContentScript({
      type: 'subtitle-result',
      text: message.text,
      isFinal: message.isFinal ?? true
    });
  }

  // Logging
  if (message.type === 'LOG') {
    console.log(`[StreamBypass:${message.source}]`, message.data);
  }

  // Stats
  if (message.type === 'BYPASS_SUCCESS') {
    stats[message.platform].bypassed++;
    stats[message.platform].lastBypass = Date.now();
  }

  if (message.type === 'GET_STATS') {
    sendResponse(stats);
    return true;
  }
});

// ============================================
// Subtitle Event Handler
// ============================================
function handleSubtitleEvent(message) {
  const event = message.event;

  switch (event) {
    case 'subtitle-result':
      forwardToContentScript({
        type: 'SUBTITLE_TEXT',
        text: message.text,
        isFinal: message.isFinal,
        confidence: message.confidence
      });
      break;

    case 'vad-speech-start':
      forwardToContentScript({ type: 'SUBTITLE_SPEECH_START' });
      break;

    case 'vad-speech-end':
      forwardToContentScript({ type: 'SUBTITLE_SPEECH_END' });
      break;

    case 'capture-started':
      forwardToContentScript({ type: 'SUBTITLE_STARTED' });
      break;

    case 'capture-stopped':
      forwardToContentScript({ type: 'SUBTITLE_STOPPED' });
      subtitleState.isActive = false;
      break;

    case 'capture-error':
    case 'stt-error':
      forwardToContentScript({
        type: 'SUBTITLE_ERROR',
        error: message.error
      });
      break;

    case 'audio-level':
      forwardToContentScript({
        type: 'SUBTITLE_AUDIO_LEVEL',
        level: message.level
      });
      break;
  }
}

function forwardToContentScript(data) {
  if (subtitleState.targetTabId) {
    chrome.tabs.sendMessage(subtitleState.targetTabId, data).catch(() => { });
  }
}

// ============================================
// Stats
// ============================================
let stats = {
  twitch: { bypassed: 0, lastBypass: null },
  chzzk: { bypassed: 0, lastBypass: null }
};

// ============================================
// Installation & Startup
// ============================================
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get('settings');
  if (!stored.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
  console.log('[StreamBypass] Extension installed');

  const settings = stored.settings || DEFAULT_SETTINGS;
  if (settings.twitch?.enabled) {
    await enableTwitchBypass();
  }
});

// Startup
(async () => {
  const settings = await getSettings();
  if (settings.twitch?.enabled) {
    await enableTwitchBypass();
  }
  console.log('[StreamBypass] Background service worker started');
})();

// Tab removal cleanup
chrome.tabs.onRemoved.addListener((tabId) => {
  if (subtitleState.targetTabId === tabId) {
    stopSubtitle();
  }
});
