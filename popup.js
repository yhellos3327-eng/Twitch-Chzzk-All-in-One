// Stream Quality Bypass - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  // 요소 참조
  const twitchEnabled = document.getElementById('twitch-enabled');
  const chzzkEnabled = document.getElementById('chzzk-enabled');
  const twitchStatus = document.getElementById('twitch-status');
  const chzzkStatus = document.getElementById('chzzk-status');
  const twitchStatusText = document.getElementById('twitch-status-text');
  const chzzkStatusText = document.getElementById('chzzk-status-text');
  const twitchCount = document.getElementById('twitch-count');
  const chzzkCount = document.getElementById('chzzk-count');
  const openSettings = document.getElementById('open-settings');

  // 설정 로드
  async function loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      return response;
    } catch (e) {
      console.error('Failed to load settings:', e);
      return null;
    }
  }

  // 통계 로드
  async function loadStats() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
      return response;
    } catch (e) {
      console.error('Failed to load stats:', e);
      return null;
    }
  }

  // UI 업데이트
  function updateUI(settings, stats) {
    if (settings) {
      // Twitch
      twitchEnabled.checked = settings.twitch?.enabled || false;
      updateStatus('twitch', settings.twitch?.enabled);

      // 치지직
      chzzkEnabled.checked = settings.chzzk?.enabled || false;
      updateStatus('chzzk', settings.chzzk?.enabled);
    }

    if (stats) {
      twitchCount.textContent = `${stats.twitch?.bypassed || 0}회`;
      chzzkCount.textContent = `${stats.chzzk?.bypassed || 0}회`;
    }
  }

  // 상태 표시 업데이트
  function updateStatus(platform, enabled) {
    const statusDot = document.getElementById(`${platform}-status`);
    const statusText = document.getElementById(`${platform}-status-text`);

    if (enabled) {
      statusDot.classList.add('active');
      statusText.textContent = '활성화됨';
    } else {
      statusDot.classList.remove('active');
      statusText.textContent = '비활성화';
    }
  }

  // 설정 저장
  async function saveSettings(newSettings) {
    try {
      await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        settings: newSettings
      });
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  }

  // 초기 로드
  const settings = await loadSettings();
  const stats = await loadStats();
  updateUI(settings, stats);

  // 이벤트 리스너
  twitchEnabled.addEventListener('change', async () => {
    const currentSettings = await loadSettings();
    currentSettings.twitch.enabled = twitchEnabled.checked;
    await saveSettings(currentSettings);
    updateStatus('twitch', twitchEnabled.checked);
  });

  chzzkEnabled.addEventListener('change', async () => {
    const currentSettings = await loadSettings();
    currentSettings.chzzk.enabled = chzzkEnabled.checked;
    await saveSettings(currentSettings);
    updateStatus('chzzk', chzzkEnabled.checked);
  });

  // 상세 설정 열기
  openSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
