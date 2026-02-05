// Keyboard Shortcuts Module - 단축키 시스템 + 도움말
// 모든 키보드 단축키 통합 관리

export const KeyboardShortcuts = {
    shortcuts: {},
    helpPanel: null,
    isHelpVisible: false,

    // 기본 단축키 정의
    defaultShortcuts: {
        // 재생 컨트롤
        'Space': { action: 'togglePlay', description: '재생/일시정지', category: '재생' },
        'k': { action: 'togglePlay', description: '재생/일시정지', category: '재생' },

        // 볼륨
        'm': { action: 'toggleMute', description: '음소거 토글', category: '볼륨' },
        'ArrowUp': { action: 'volumeUp', description: '볼륨 +5%', category: '볼륨' },
        'ArrowDown': { action: 'volumeDown', description: '볼륨 -5%', category: '볼륨' },

        // 탐색 (타임머신)
        'j': { action: 'seekBack10', description: '10초 뒤로', category: '탐색' },
        'l': { action: 'seekForward10', description: '10초 앞으로', category: '탐색' },
        'ArrowLeft': { action: 'seekBack5', description: '5초 뒤로', category: '탐색' },
        'ArrowRight': { action: 'seekForward5', description: '5초 앞으로', category: '탐색' },
        'Shift+ArrowLeft': { action: 'seekBack30', description: '30초 뒤로', category: '탐색' },
        'Shift+ArrowRight': { action: 'seekForward30', description: '30초 앞으로', category: '탐색' },
        'Home': { action: 'goLive', description: '라이브로 이동', category: '탐색' },

        // 미디어 도구
        'Shift+s': { action: 'screenshot', description: '스크린샷', category: '미디어' },
        'Shift+r': { action: 'toggleRecording', description: '클립 녹화 시작/중지', category: '미디어' },

        // 화면
        'f': { action: 'toggleFullscreen', description: '전체화면', category: '화면' },
        'p': { action: 'togglePIP', description: 'PIP 모드', category: '화면' },
        't': { action: 'toggleTheater', description: '극장 모드', category: '화면' },

        // 자막
        'c': { action: 'toggleCaptions', description: '자막 토글', category: '자막' },
        'Shift+c': { action: 'toggleTranslation', description: '번역 토글', category: '자막' },

        // 채팅
        'h': { action: 'toggleChat', description: '채팅 토글', category: '채팅' },

        // 재생 속도
        'Shift+.': { action: 'speedUp', description: '재생 속도 +0.25x', category: '속도' },
        'Shift+,': { action: 'speedDown', description: '재생 속도 -0.25x', category: '속도' },
        'Shift+/': { action: 'speedReset', description: '재생 속도 1x', category: '속도' },

        // 화질
        '1': { action: 'quality1', description: '최저 화질', category: '화질' },
        '2': { action: 'quality2', description: '낮은 화질', category: '화질' },
        '3': { action: 'quality3', description: '중간 화질', category: '화질' },
        '4': { action: 'quality4', description: '높은 화질', category: '화질' },
        '5': { action: 'quality5', description: '최고 화질', category: '화질' },

        // 기타
        'i': { action: 'toggleStats', description: '통계 패널', category: '기타' },
        '?': { action: 'toggleHelp', description: '단축키 도움말', category: '기타' },
        'Escape': { action: 'closeOverlays', description: '오버레이 닫기', category: '기타' }
    },

    // 액션 핸들러 참조
    handlers: {},

    init(handlers = {}) {
        this.handlers = handlers;
        this.shortcuts = { ...this.defaultShortcuts };
        this.loadCustomShortcuts();
        this.createHelpPanel();
        this.setupEventListeners();

        console.log('[KeyboardShortcuts] Initialized');
    },

    createHelpPanel() {
        this.helpPanel = document.createElement('div');
        this.helpPanel.id = 'shortcuts-help';
        this.helpPanel.className = 'shortcuts-help';

        const categories = this.groupByCategory();
        let html = `
            <div class="shortcuts-header">
                <h2>⌨️ 키보드 단축키</h2>
                <button class="shortcuts-close" title="닫기">×</button>
            </div>
            <div class="shortcuts-content">
        `;

        for (const [category, shortcuts] of Object.entries(categories)) {
            html += `
                <div class="shortcuts-category">
                    <h3>${category}</h3>
                    <div class="shortcuts-list">
            `;

            for (const [key, info] of shortcuts) {
                const displayKey = this.formatKeyDisplay(key);
                html += `
                    <div class="shortcut-item">
                        <kbd>${displayKey}</kbd>
                        <span>${info.description}</span>
                    </div>
                `;
            }

            html += `
                    </div>
                </div>
            `;
        }

        html += `</div>`;
        this.helpPanel.innerHTML = html;

        document.getElementById('player-container')?.appendChild(this.helpPanel);

        // 닫기 버튼
        this.helpPanel.querySelector('.shortcuts-close').addEventListener('click', () => {
            this.hideHelp();
        });
    },

    groupByCategory() {
        const categories = {};

        for (const [key, info] of Object.entries(this.shortcuts)) {
            const cat = info.category || '기타';
            if (!categories[cat]) {
                categories[cat] = [];
            }
            categories[cat].push([key, info]);
        }

        return categories;
    },

    formatKeyDisplay(key) {
        // 키 표시 포맷팅
        return key
            .replace('Shift+', '⇧ ')
            .replace('Ctrl+', '⌃ ')
            .replace('Alt+', '⌥ ')
            .replace('ArrowUp', '↑')
            .replace('ArrowDown', '↓')
            .replace('ArrowLeft', '←')
            .replace('ArrowRight', '→')
            .replace('Space', '␣')
            .replace('Escape', 'Esc');
    },

    setupEventListeners() {
        document.addEventListener('keydown', (e) => {
            // 입력 필드에서는 무시
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            const key = this.getKeyString(e);
            const shortcut = this.shortcuts[key];

            if (shortcut) {
                e.preventDefault();
                this.executeAction(shortcut.action);
            }
        });
    },

    getKeyString(e) {
        let key = '';

        if (e.shiftKey && e.key !== 'Shift') key += 'Shift+';
        if (e.ctrlKey && e.key !== 'Control') key += 'Ctrl+';
        if (e.altKey && e.key !== 'Alt') key += 'Alt+';

        // 특수 키 처리
        if (e.key === ' ') {
            key += 'Space';
        } else if (e.key.length === 1) {
            key += e.key.toLowerCase();
        } else {
            key += e.key;
        }

        return key;
    },

    executeAction(action) {
        const handler = this.handlers[action];

        if (typeof handler === 'function') {
            handler();
        } else {
            console.warn('[KeyboardShortcuts] No handler for action:', action);
        }
    },

    registerHandler(action, handler) {
        this.handlers[action] = handler;
    },

    registerHandlers(handlers) {
        Object.assign(this.handlers, handlers);
    },

    showHelp() {
        if (this.helpPanel) {
            this.helpPanel.classList.add('visible');
            this.isHelpVisible = true;
        }
    },

    hideHelp() {
        if (this.helpPanel) {
            this.helpPanel.classList.remove('visible');
            this.isHelpVisible = false;
        }
    },

    toggleHelp() {
        if (this.isHelpVisible) {
            this.hideHelp();
        } else {
            this.showHelp();
        }
    },

    // 커스텀 단축키 저장/로드
    saveCustomShortcuts() {
        try {
            localStorage.setItem('customShortcuts', JSON.stringify(this.shortcuts));
        } catch (e) {
            console.error('[KeyboardShortcuts] Save error:', e);
        }
    },

    loadCustomShortcuts() {
        try {
            const saved = localStorage.getItem('customShortcuts');
            if (saved) {
                const custom = JSON.parse(saved);
                this.shortcuts = { ...this.defaultShortcuts, ...custom };
            }
        } catch (e) {
            console.error('[KeyboardShortcuts] Load error:', e);
        }
    },

    // 단축키 변경
    setShortcut(key, action, description, category) {
        this.shortcuts[key] = { action, description, category };
        this.saveCustomShortcuts();
        this.refreshHelpPanel();
    },

    // 단축키 제거
    removeShortcut(key) {
        delete this.shortcuts[key];
        this.saveCustomShortcuts();
        this.refreshHelpPanel();
    },

    // 기본값 복원
    resetToDefaults() {
        this.shortcuts = { ...this.defaultShortcuts };
        localStorage.removeItem('customShortcuts');
        this.refreshHelpPanel();
    },

    refreshHelpPanel() {
        if (this.helpPanel) {
            this.helpPanel.remove();
            this.createHelpPanel();
        }
    }
};
