// Stream Quality Bypass - Options Dashboard Script

document.addEventListener('DOMContentLoaded', async () => {
  // ===== 요소 참조 =====

  // 네비게이션
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.section');

  // 대시보드
  const dashTwitchToggle = document.getElementById('dash-twitch-toggle');
  const dashChzzkToggle = document.getElementById('dash-chzzk-toggle');
  const dashTwitchStatus = document.getElementById('dash-twitch-status');
  const dashChzzkStatus = document.getElementById('dash-chzzk-status');
  const dashTwitchLabel = document.getElementById('dash-twitch-label');
  const dashChzzkLabel = document.getElementById('dash-chzzk-label');
  const dashTwitchCount = document.getElementById('dash-twitch-count');
  const dashChzzkCount = document.getElementById('dash-chzzk-count');
  const dashProxyStatus = document.getElementById('dash-proxy-status');
  const dashProxyLabel = document.getElementById('dash-proxy-label');
  const dashProxyUrl = document.getElementById('dash-proxy-url');

  // Twitch 설정
  const twitchEnabled = document.getElementById('twitch-enabled');
  const twitchQuality = document.getElementById('twitch-quality');
  const twitchDebug = document.getElementById('twitch-debug');

  // 치지직 설정
  const chzzkEnabled = document.getElementById('chzzk-enabled');
  const chzzkDisableGrid = document.getElementById('chzzk-disable-grid');
  const chzzkDisableWebrtc = document.getElementById('chzzk-disable-webrtc');
  const chzzkQuality = document.getElementById('chzzk-quality');

  // 프록시 설정
  const proxyUrl = document.getElementById('proxy-url');
  const testProxy = document.getElementById('test-proxy');
  const proxyTestResult = document.getElementById('proxy-test-result');
  const proxyEnabled = document.getElementById('proxy-enabled');

  // 기타
  const copyWorkerCode = document.getElementById('copy-worker-code');
  const workerCode = document.getElementById('worker-code');
  const resetSettings = document.getElementById('reset-settings');

  // ===== 기본 설정 =====
  const DEFAULT_SETTINGS = {
    twitch: {
      enabled: true,
      proxyUrl: '',
      preferredQuality: 'auto',
      debug: false
    },
    chzzk: {
      enabled: true,
      disableGrid: true,
      disableWebrtc: true,
      preferredQuality: 'auto'
    },
    proxy: {
      url: '',
      enabled: false
    }
  };

  // ===== 유틸리티 함수 =====

  async function loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      return response || DEFAULT_SETTINGS;
    } catch (e) {
      console.error('Failed to load settings:', e);
      return DEFAULT_SETTINGS;
    }
  }

  async function saveSettings(settings) {
    try {
      await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings });
      console.log('Settings saved:', settings);
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  }

  async function loadStats() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
      return response || { twitch: { bypassed: 0 }, chzzk: { bypassed: 0 } };
    } catch (e) {
      console.error('Failed to load stats:', e);
      return { twitch: { bypassed: 0 }, chzzk: { bypassed: 0 } };
    }
  }

  function updateStatusDot(element, label, isActive) {
    if (isActive) {
      element.classList.add('active');
      label.textContent = '활성화됨';
    } else {
      element.classList.remove('active');
      label.textContent = '비활성화';
    }
  }

  // ===== 네비게이션 =====

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();

      // 활성 네비게이션 업데이트
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      // 섹션 전환
      const targetSection = item.dataset.section;
      sections.forEach(section => {
        section.classList.remove('active');
        if (section.id === targetSection) {
          section.classList.add('active');
        }
      });
    });
  });

  // ===== UI 초기화 =====

  async function initUI() {
    const settings = await loadSettings();
    const stats = await loadStats();

    // 대시보드 업데이트
    dashTwitchToggle.checked = settings.twitch?.enabled || false;
    dashChzzkToggle.checked = settings.chzzk?.enabled || false;
    updateStatusDot(dashTwitchStatus, dashTwitchLabel, settings.twitch?.enabled);
    updateStatusDot(dashChzzkStatus, dashChzzkLabel, settings.chzzk?.enabled);
    dashTwitchCount.textContent = stats.twitch?.bypassed || 0;
    dashChzzkCount.textContent = stats.chzzk?.bypassed || 0;

    // 프록시 상태
    const proxyConfigured = settings.proxy?.url || settings.twitch?.proxyUrl;
    if (proxyConfigured) {
      dashProxyStatus.classList.add('active');
      dashProxyLabel.textContent = '설정됨';
      dashProxyUrl.textContent = proxyConfigured;
    } else {
      dashProxyStatus.classList.remove('active');
      dashProxyLabel.textContent = '미설정';
      dashProxyUrl.textContent = '프록시 URL을 설정해주세요';
    }

    // Twitch 설정
    twitchEnabled.checked = settings.twitch?.enabled || false;
    twitchQuality.value = settings.twitch?.preferredQuality || 'auto';
    twitchDebug.checked = settings.twitch?.debug || false;

    // 치지직 설정
    chzzkEnabled.checked = settings.chzzk?.enabled || false;
    chzzkDisableGrid.checked = settings.chzzk?.disableGrid !== false;
    chzzkDisableWebrtc.checked = settings.chzzk?.disableWebrtc !== false;
    chzzkQuality.value = settings.chzzk?.preferredQuality || 'auto';

    // 프록시 설정
    proxyUrl.value = settings.proxy?.url || settings.twitch?.proxyUrl || '';
    proxyEnabled.checked = settings.proxy?.enabled || false;
  }

  // ===== 이벤트 리스너 =====

  // 대시보드 토글
  dashTwitchToggle.addEventListener('change', async () => {
    const settings = await loadSettings();
    settings.twitch.enabled = dashTwitchToggle.checked;
    await saveSettings(settings);
    updateStatusDot(dashTwitchStatus, dashTwitchLabel, dashTwitchToggle.checked);
    twitchEnabled.checked = dashTwitchToggle.checked;
  });

  dashChzzkToggle.addEventListener('change', async () => {
    const settings = await loadSettings();
    settings.chzzk.enabled = dashChzzkToggle.checked;
    await saveSettings(settings);
    updateStatusDot(dashChzzkStatus, dashChzzkLabel, dashChzzkToggle.checked);
    chzzkEnabled.checked = dashChzzkToggle.checked;
  });

  // Twitch 설정
  twitchEnabled.addEventListener('change', async () => {
    const settings = await loadSettings();
    settings.twitch.enabled = twitchEnabled.checked;
    await saveSettings(settings);
    dashTwitchToggle.checked = twitchEnabled.checked;
    updateStatusDot(dashTwitchStatus, dashTwitchLabel, twitchEnabled.checked);
  });

  twitchQuality.addEventListener('change', async () => {
    const settings = await loadSettings();
    settings.twitch.preferredQuality = twitchQuality.value;
    await saveSettings(settings);
  });

  twitchDebug.addEventListener('change', async () => {
    const settings = await loadSettings();
    settings.twitch.debug = twitchDebug.checked;
    await saveSettings(settings);
  });

  // 치지직 설정
  chzzkEnabled.addEventListener('change', async () => {
    const settings = await loadSettings();
    settings.chzzk.enabled = chzzkEnabled.checked;
    await saveSettings(settings);
    dashChzzkToggle.checked = chzzkEnabled.checked;
    updateStatusDot(dashChzzkStatus, dashChzzkLabel, chzzkEnabled.checked);
  });

  chzzkDisableGrid.addEventListener('change', async () => {
    const settings = await loadSettings();
    settings.chzzk.disableGrid = chzzkDisableGrid.checked;
    await saveSettings(settings);
  });

  chzzkDisableWebrtc.addEventListener('change', async () => {
    const settings = await loadSettings();
    settings.chzzk.disableWebrtc = chzzkDisableWebrtc.checked;
    await saveSettings(settings);
  });

  chzzkQuality.addEventListener('change', async () => {
    const settings = await loadSettings();
    settings.chzzk.preferredQuality = chzzkQuality.value;
    await saveSettings(settings);
  });

  // 프록시 설정
  proxyUrl.addEventListener('change', async () => {
    const settings = await loadSettings();
    if (!settings.proxy) settings.proxy = {};
    settings.proxy.url = proxyUrl.value;
    settings.twitch.proxyUrl = proxyUrl.value;
    await saveSettings(settings);

    // 대시보드 프록시 상태 업데이트
    if (proxyUrl.value) {
      dashProxyStatus.classList.add('active');
      dashProxyLabel.textContent = '설정됨';
      dashProxyUrl.textContent = proxyUrl.value;
    } else {
      dashProxyStatus.classList.remove('active');
      dashProxyLabel.textContent = '미설정';
      dashProxyUrl.textContent = '프록시 URL을 설정해주세요';
    }
  });

  proxyEnabled.addEventListener('change', async () => {
    const settings = await loadSettings();
    if (!settings.proxy) settings.proxy = {};
    settings.proxy.enabled = proxyEnabled.checked;
    await saveSettings(settings);
  });

  // 프록시 테스트
  testProxy.addEventListener('click', async () => {
    const url = proxyUrl.value.trim();

    if (!url) {
      proxyTestResult.textContent = '프록시 URL을 입력해주세요';
      proxyTestResult.className = 'test-result error';
      return;
    }

    proxyTestResult.textContent = '연결 테스트 중...';
    proxyTestResult.className = 'test-result';
    proxyTestResult.style.display = 'block';

    try {
      const testUrl = `${url}?url=${encodeURIComponent('https://httpbin.org/get')}`;
      const response = await fetch(testUrl, { method: 'GET', mode: 'cors' });

      if (response.ok) {
        proxyTestResult.textContent = '✓ 연결 성공! 프록시 서버가 정상 작동합니다.';
        proxyTestResult.className = 'test-result success';
      } else {
        proxyTestResult.textContent = `✗ 연결 실패: HTTP ${response.status}`;
        proxyTestResult.className = 'test-result error';
      }
    } catch (e) {
      proxyTestResult.textContent = `✗ 연결 실패: ${e.message}`;
      proxyTestResult.className = 'test-result error';
    }
  });

  // 코드 복사
  copyWorkerCode.addEventListener('click', () => {
    const code = workerCode.textContent;
    navigator.clipboard.writeText(code).then(() => {
      copyWorkerCode.textContent = '복사됨!';
      setTimeout(() => {
        copyWorkerCode.textContent = '복사';
      }, 2000);
    });
  });

  // 설정 초기화
  resetSettings.addEventListener('click', async () => {
    if (confirm('모든 설정을 초기화하시겠습니까?')) {
      await saveSettings(DEFAULT_SETTINGS);
      await initUI();
      alert('설정이 초기화되었습니다.');
    }
  });

  // ===== 초기화 =====
  await initUI();

  // 통계 주기적 업데이트
  setInterval(async () => {
    const stats = await loadStats();
    dashTwitchCount.textContent = stats.twitch?.bypassed || 0;
    dashChzzkCount.textContent = stats.chzzk?.bypassed || 0;
  }, 5000);
});
