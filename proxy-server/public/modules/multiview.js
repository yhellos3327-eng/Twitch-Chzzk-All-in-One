// MultiView Module - 다른 스트리머 동시 시청 및 플레이어 모드 선택
// PIP 대안 모드: 팝아웃, 미니 플레이어, 극장 모드
// 멀티뷰: 최대 4개 스트림 동시 시청

export const MultiView = {
    // 현재 상태
    isMultiViewActive: false,
    streams: [], // { channel, container, hls }
    maxStreams: 4,
    currentLayout: '2x2', // 1x1, 2x1, 2x2, 1+3

    // 플레이어 모드
    currentMode: 'normal', // normal, pip, popout, mini, theater
    popoutWindow: null,
    miniPlayer: null,

    videoElement: null,
    currentChannel: null,

    init(videoEl, channel) {
        this.videoElement = videoEl;
        this.currentChannel = channel;
        this.createModeMenu();
        this.setupEventListeners();
        console.log('[MultiView] Initialized');
    },

    // 모드 선택 메뉴 생성
    createModeMenu() {
        const pipBtn = document.getElementById('pip-btn');
        if (!pipBtn) return;

        // 메뉴 컨테이너 생성
        const menuWrapper = document.createElement('div');
        menuWrapper.className = 'pip-menu-wrapper';
        menuWrapper.innerHTML = `
            <div class="pip-menu" id="pip-menu">
                <div class="pip-menu-section">
                    <div class="pip-menu-title">플레이어 모드</div>
                    <button class="pip-menu-item" data-mode="pip">
                        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/></svg>
                        <span>PIP (브라우저)</span>
                    </button>
                    <button class="pip-menu-item" data-mode="popout">
                        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
                        <span>팝아웃 창</span>
                    </button>
                    <button class="pip-menu-item" data-mode="mini">
                        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM9 8h2v8H9zm4 4h2v4h-2z"/></svg>
                        <span>미니 플레이어</span>
                    </button>
                    <button class="pip-menu-item" data-mode="theater">
                        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M20 3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H4V5h16v14z"/></svg>
                        <span>극장 모드</span>
                    </button>
                </div>
                <div class="pip-menu-divider"></div>
                <div class="pip-menu-section">
                    <div class="pip-menu-title">멀티뷰</div>
                    <button class="pip-menu-item" data-action="multiview">
                        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 5v14h18V5H3zm4 12H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V7h2v2zm10 8H9v-6h8v6zm0-8H9V7h8v2zm4 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V7h2v2z"/></svg>
                        <span>멀티뷰 열기</span>
                    </button>
                </div>
            </div>
        `;

        pipBtn.parentNode.style.position = 'relative';
        pipBtn.parentNode.appendChild(menuWrapper);

        // 스타일 추가
        this.injectStyles();
    },

    injectStyles() {
        if (document.getElementById('multiview-styles')) return;

        const style = document.createElement('style');
        style.id = 'multiview-styles';
        style.textContent = `
            .pip-menu-wrapper {
                position: relative;
            }
            
            .pip-menu {
                position: absolute;
                bottom: calc(100% + 12px);
                right: 0;
                background: linear-gradient(180deg, rgba(30, 30, 40, 0.98), rgba(20, 20, 30, 0.98));
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border-radius: 14px;
                padding: 8px;
                min-width: 180px;
                display: none;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
                border: 1px solid rgba(255, 255, 255, 0.1);
                z-index: 1000;
                animation: slideUp 0.2s ease-out;
            }
            
            .pip-menu.show {
                display: block;
            }
            
            .pip-menu-section {
                padding: 4px 0;
            }
            
            .pip-menu-title {
                padding: 6px 12px;
                font-size: 11px;
                font-weight: 600;
                color: rgba(255, 255, 255, 0.4);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .pip-menu-item {
                display: flex;
                align-items: center;
                gap: 10px;
                width: 100%;
                padding: 10px 12px;
                background: none;
                border: none;
                border-radius: 8px;
                color: rgba(255, 255, 255, 0.8);
                font-size: 13px;
                cursor: pointer;
                transition: all 0.15s;
                text-align: left;
            }
            
            .pip-menu-item:hover {
                background: rgba(255, 255, 255, 0.1);
                color: white;
            }
            
            .pip-menu-item.active {
                background: linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(6, 182, 212, 0.3));
                color: white;
            }
            
            .pip-menu-item svg {
                flex-shrink: 0;
                opacity: 0.7;
            }
            
            .pip-menu-divider {
                height: 1px;
                background: rgba(255, 255, 255, 0.1);
                margin: 4px 8px;
            }

            /* 미니 플레이어 */
            .mini-player {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 400px;
                height: 225px;
                background: #000;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
                z-index: 9999;
                cursor: move;
                border: 2px solid rgba(255, 255, 255, 0.1);
                transition: transform 0.2s, box-shadow 0.2s;
            }
            
            .mini-player:hover {
                box-shadow: 0 12px 48px rgba(0, 0, 0, 0.8);
            }
            
            .mini-player video {
                width: 100%;
                height: 100%;
                object-fit: contain;
            }
            
            .mini-player-controls {
                position: absolute;
                top: 8px;
                right: 8px;
                display: flex;
                gap: 4px;
                opacity: 0;
                transition: opacity 0.2s;
            }
            
            .mini-player:hover .mini-player-controls {
                opacity: 1;
            }
            
            .mini-player-btn {
                width: 28px;
                height: 28px;
                border-radius: 6px;
                border: none;
                background: rgba(0, 0, 0, 0.7);
                color: white;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.15s;
            }
            
            .mini-player-btn:hover {
                background: rgba(255, 255, 255, 0.2);
            }

            /* 극장 모드 */
            body.theater-mode #player-container {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                z-index: 9998;
                background: #000;
            }
            
            body.theater-mode #sidebar {
                display: none;
            }
            
            body.theater-mode .video-wrapper {
                height: 100vh;
            }

            /* 멀티뷰 */
            .multiview-container {
                position: fixed;
                inset: 0;
                background: #0a0a0f;
                z-index: 10000;
                display: grid;
                gap: 4px;
                padding: 4px;
            }
            
            .multiview-container.layout-1x1 {
                grid-template-columns: 1fr;
            }
            
            .multiview-container.layout-2x1 {
                grid-template-columns: 1fr 1fr;
            }
            
            .multiview-container.layout-2x2 {
                grid-template-columns: 1fr 1fr;
                grid-template-rows: 1fr 1fr;
            }
            
            .multiview-container.layout-1plus3 {
                grid-template-columns: 2fr 1fr;
                grid-template-rows: 1fr 1fr 1fr;
            }
            
            .multiview-container.layout-1plus3 .multiview-slot:first-child {
                grid-row: span 3;
            }
            
            .multiview-slot {
                position: relative;
                background: #15151f;
                border-radius: 8px;
                overflow: hidden;
            }
            
            .multiview-slot video {
                width: 100%;
                height: 100%;
                object-fit: contain;
            }
            
            .multiview-slot-controls {
                position: absolute;
                top: 8px;
                left: 8px;
                right: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                opacity: 0;
                transition: opacity 0.2s;
            }
            
            .multiview-slot:hover .multiview-slot-controls {
                opacity: 1;
            }
            
            .multiview-slot-info {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 10px;
                background: rgba(0, 0, 0, 0.7);
                border-radius: 6px;
                color: white;
                font-size: 12px;
            }
            
            .multiview-slot-actions {
                display: flex;
                gap: 4px;
            }
            
            .multiview-slot-btn {
                width: 28px;
                height: 28px;
                border-radius: 6px;
                border: none;
                background: rgba(0, 0, 0, 0.7);
                color: white;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .multiview-slot-btn:hover {
                background: rgba(255, 255, 255, 0.2);
            }
            
            .multiview-slot-empty {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100%;
                color: rgba(255, 255, 255, 0.4);
                gap: 12px;
            }
            
            .multiview-slot-empty svg {
                width: 48px;
                height: 48px;
                opacity: 0.3;
            }
            
            .multiview-add-btn {
                padding: 10px 20px;
                background: rgba(255, 255, 255, 0.1);
                border: 1px dashed rgba(255, 255, 255, 0.2);
                border-radius: 8px;
                color: rgba(255, 255, 255, 0.6);
                cursor: pointer;
                transition: all 0.2s;
            }
            
            .multiview-add-btn:hover {
                background: rgba(255, 255, 255, 0.15);
                color: white;
            }

            .multiview-toolbar {
                position: fixed;
                top: 10px;
                left: 50%;
                transform: translateX(-50%);
                display: flex;
                gap: 8px;
                padding: 8px 16px;
                background: rgba(0, 0, 0, 0.8);
                backdrop-filter: blur(10px);
                border-radius: 10px;
                z-index: 10001;
            }
            
            .multiview-toolbar-btn {
                padding: 8px 16px;
                background: rgba(255, 255, 255, 0.1);
                border: none;
                border-radius: 6px;
                color: white;
                cursor: pointer;
                font-size: 13px;
                transition: background 0.15s;
            }
            
            .multiview-toolbar-btn:hover {
                background: rgba(255, 255, 255, 0.2);
            }
            
            .multiview-toolbar-btn.active {
                background: linear-gradient(135deg, #8b5cf6, #06b6d4);
            }

            /* 채널 추가 다이얼로그 */
            .add-channel-dialog {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.8);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10002;
            }
            
            .add-channel-content {
                background: linear-gradient(180deg, rgba(30, 30, 40, 0.98), rgba(20, 20, 30, 0.98));
                border-radius: 16px;
                padding: 24px;
                width: 90%;
                max-width: 400px;
            }
            
            .add-channel-content h3 {
                margin: 0 0 16px;
                color: white;
            }
            
            .add-channel-content input {
                width: 100%;
                padding: 12px 16px;
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 10px;
                color: white;
                font-size: 14px;
                margin-bottom: 16px;
                outline: none;
            }
            
            .add-channel-content input:focus {
                border-color: #8b5cf6;
            }
            
            .add-channel-buttons {
                display: flex;
                gap: 10px;
            }
            
            .add-channel-btn {
                flex: 1;
                padding: 12px;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s;
            }
            
            .add-channel-btn.primary {
                background: linear-gradient(135deg, #8b5cf6, #06b6d4);
                color: white;
            }
            
            .add-channel-btn.secondary {
                background: rgba(255, 255, 255, 0.1);
                color: white;
            }
        `;

        document.head.appendChild(style);
    },

    setupEventListeners() {
        const pipBtn = document.getElementById('pip-btn');
        const pipMenu = document.getElementById('pip-menu');

        if (pipBtn && pipMenu) {
            // 클릭 시 메뉴 토글
            pipBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                pipMenu.classList.toggle('show');
            });

            // 메뉴 항목 클릭
            pipMenu.querySelectorAll('.pip-menu-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const mode = item.dataset.mode;
                    const action = item.dataset.action;

                    if (mode) {
                        this.setMode(mode);
                    } else if (action === 'multiview') {
                        this.openMultiView();
                    }

                    pipMenu.classList.remove('show');
                });
            });

            // 외부 클릭 시 메뉴 닫기
            document.addEventListener('click', () => {
                pipMenu.classList.remove('show');
            });
        }
    },

    // 플레이어 모드 설정
    async setMode(mode) {
        // 이전 모드 정리
        this.cleanupMode();

        this.currentMode = mode;

        switch (mode) {
            case 'pip':
                await this.enterPIP();
                break;
            case 'popout':
                this.openPopout();
                break;
            case 'mini':
                this.createMiniPlayer();
                break;
            case 'theater':
                this.toggleTheaterMode();
                break;
        }

        this.showNotification(`${this.getModeLabel(mode)} 활성화`, 'success');
    },

    cleanupMode() {
        // 미니 플레이어 정리
        if (this.miniPlayer) {
            this.miniPlayer.remove();
            this.miniPlayer = null;
        }

        // 극장 모드 해제
        document.body.classList.remove('theater-mode');

        // PIP 해제
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture();
        }
    },

    getModeLabel(mode) {
        const labels = {
            pip: 'PIP',
            popout: '팝아웃 창',
            mini: '미니 플레이어',
            theater: '극장 모드'
        };
        return labels[mode] || mode;
    },

    // PIP 모드
    async enterPIP() {
        if (!this.videoElement) return;

        try {
            if (document.pictureInPictureEnabled) {
                await this.videoElement.requestPictureInPicture();
            } else {
                this.showNotification('PIP가 지원되지 않습니다', 'error');
            }
        } catch (e) {
            console.error('[MultiView] PIP failed:', e);
            this.showNotification('PIP 활성화 실패', 'error');
        }
    },

    // 팝아웃 창
    openPopout() {
        const width = 800;
        const height = 450;
        const left = (screen.width - width) / 2;
        const top = (screen.height - height) / 2;

        const popoutUrl = `${window.location.origin}/player.html?channel=${this.currentChannel}&popout=true`;

        this.popoutWindow = window.open(
            popoutUrl,
            'popout_player',
            `width=${width},height=${height},left=${left},top=${top},resizable=yes`
        );
    },

    // 미니 플레이어
    createMiniPlayer() {
        if (this.miniPlayer) return;

        this.miniPlayer = document.createElement('div');
        this.miniPlayer.className = 'mini-player';
        this.miniPlayer.innerHTML = `
            <video id="mini-video" autoplay muted></video>
            <div class="mini-player-controls">
                <button class="mini-player-btn" data-action="expand" title="확대">
                    <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
                </button>
                <button class="mini-player-btn" data-action="close" title="닫기">
                    <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
            </div>
        `;

        document.body.appendChild(this.miniPlayer);

        // 비디오 미러링
        const miniVideo = this.miniPlayer.querySelector('#mini-video');
        if (this.videoElement.captureStream) {
            miniVideo.srcObject = this.videoElement.captureStream();
        }

        // 드래그 이동
        this.makeDraggable(this.miniPlayer);

        // 컨트롤 이벤트
        this.miniPlayer.querySelectorAll('.mini-player-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                if (action === 'close') {
                    this.cleanupMode();
                } else if (action === 'expand') {
                    this.cleanupMode();
                    window.scrollTo(0, 0);
                }
            });
        });
    },

    makeDraggable(element) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

        element.onmousedown = (e) => {
            if (e.target.closest('button')) return;
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDrag;
            document.onmousemove = elementDrag;
        };

        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
            element.style.right = 'auto';
            element.style.bottom = 'auto';
        }

        function closeDrag() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    },

    // 극장 모드
    toggleTheaterMode() {
        document.body.classList.toggle('theater-mode');
    },

    // 멀티뷰
    openMultiView() {
        if (this.isMultiViewActive) return;
        this.isMultiViewActive = true;

        // 멀티뷰 컨테이너 생성
        const container = document.createElement('div');
        container.id = 'multiview-container';
        container.className = 'multiview-container layout-2x2';

        // 툴바
        const toolbar = document.createElement('div');
        toolbar.className = 'multiview-toolbar';
        toolbar.innerHTML = `
            <button class="multiview-toolbar-btn" data-layout="2x1">2x1</button>
            <button class="multiview-toolbar-btn active" data-layout="2x2">2x2</button>
            <button class="multiview-toolbar-btn" data-layout="1plus3">1+3</button>
            <button class="multiview-toolbar-btn" data-action="close">닫기</button>
        `;

        // 초기 슬롯 생성
        for (let i = 0; i < 4; i++) {
            const slot = this.createSlot(i);
            container.appendChild(slot);
        }

        // 첫 번째 슬롯에 현재 스트림 추가
        this.addStreamToSlot(0, this.currentChannel);

        document.body.appendChild(container);
        document.body.appendChild(toolbar);

        // 이벤트 핸들러
        toolbar.querySelectorAll('.multiview-toolbar-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const layout = btn.dataset.layout;
                const action = btn.dataset.action;

                if (layout) {
                    this.setLayout(layout);
                    toolbar.querySelectorAll('.multiview-toolbar-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                } else if (action === 'close') {
                    this.closeMultiView();
                }
            });
        });
    },

    createSlot(index) {
        const slot = document.createElement('div');
        slot.className = 'multiview-slot';
        slot.dataset.index = index;
        slot.innerHTML = `
            <div class="multiview-slot-empty">
                <svg viewBox="0 0 24 24"><path fill="currentColor" d="M21 3H3c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.11-.9-2-2-2zm0 14H3V5h18v12z"/></svg>
                <button class="multiview-add-btn" data-slot="${index}">+ 스트림 추가</button>
            </div>
        `;

        slot.querySelector('.multiview-add-btn').addEventListener('click', () => {
            this.showAddChannelDialog(index);
        });

        return slot;
    },

    async addStreamToSlot(slotIndex, channel) {
        const container = document.getElementById('multiview-container');
        if (!container) return;

        const slot = container.querySelector(`.multiview-slot[data-index="${slotIndex}"]`);
        if (!slot) return;

        try {
            // 스트림 정보 가져오기
            const response = await fetch(`/api/twitch/stream/${channel}`);
            const data = await response.json();

            if (!data.qualities?.length) {
                this.showNotification(`${channel}: 스트림을 찾을 수 없습니다`, 'error');
                return;
            }

            slot.innerHTML = `
                <video autoplay muted></video>
                <div class="multiview-slot-controls">
                    <div class="multiview-slot-info">
                        <span>${channel}</span>
                    </div>
                    <div class="multiview-slot-actions">
                        <button class="multiview-slot-btn" data-action="unmute" title="음소거 해제">
                            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
                        </button>
                        <button class="multiview-slot-btn" data-action="remove" title="제거">
                            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                        </button>
                    </div>
                </div>
            `;

            const video = slot.querySelector('video');

            // HLS 로드
            if (Hls.isSupported()) {
                const hls = new Hls({ debug: false, enableWorker: true });
                hls.loadSource(data.qualities[0].url);
                hls.attachMedia(video);

                this.streams.push({ channel, slot: slotIndex, hls, video });
            }

            // 컨트롤 이벤트
            slot.querySelector('[data-action="unmute"]').addEventListener('click', () => {
                // 다른 모든 비디오 음소거
                this.streams.forEach(s => s.video.muted = true);
                video.muted = false;
            });

            slot.querySelector('[data-action="remove"]').addEventListener('click', () => {
                this.removeStreamFromSlot(slotIndex);
            });

        } catch (e) {
            console.error('[MultiView] Failed to add stream:', e);
            this.showNotification('스트림 추가 실패', 'error');
        }
    },

    removeStreamFromSlot(slotIndex) {
        const streamIndex = this.streams.findIndex(s => s.slot === slotIndex);
        if (streamIndex !== -1) {
            const stream = this.streams[streamIndex];
            if (stream.hls) stream.hls.destroy();
            this.streams.splice(streamIndex, 1);
        }

        const container = document.getElementById('multiview-container');
        const oldSlot = container?.querySelector(`.multiview-slot[data-index="${slotIndex}"]`);
        if (oldSlot) {
            const newSlot = this.createSlot(slotIndex);
            oldSlot.replaceWith(newSlot);
        }
    },

    showAddChannelDialog(slotIndex) {
        const dialog = document.createElement('div');
        dialog.className = 'add-channel-dialog';
        dialog.innerHTML = `
            <div class="add-channel-content">
                <h3>📺 스트림 추가</h3>
                <input type="text" placeholder="채널명 입력 (예: xqc, shroud)" autofocus>
                <div class="add-channel-buttons">
                    <button class="add-channel-btn secondary">취소</button>
                    <button class="add-channel-btn primary">추가</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        const input = dialog.querySelector('input');
        const addBtn = dialog.querySelector('.add-channel-btn.primary');
        const cancelBtn = dialog.querySelector('.add-channel-btn.secondary');

        const add = () => {
            const channel = input.value.trim();
            if (channel) {
                this.addStreamToSlot(slotIndex, channel);
            }
            dialog.remove();
        };

        addBtn.addEventListener('click', add);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') add();
            if (e.key === 'Escape') dialog.remove();
        });
        cancelBtn.addEventListener('click', () => dialog.remove());
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) dialog.remove();
        });

        input.focus();
    },

    setLayout(layout) {
        const container = document.getElementById('multiview-container');
        if (!container) return;

        container.className = `multiview-container layout-${layout}`;
        this.currentLayout = layout;
    },

    closeMultiView() {
        this.isMultiViewActive = false;

        // 스트림 정리
        this.streams.forEach(s => {
            if (s.hls) s.hls.destroy();
        });
        this.streams = [];

        // UI 제거
        document.getElementById('multiview-container')?.remove();
        document.querySelector('.multiview-toolbar')?.remove();
    },

    showNotification(message, type = 'info') {
        const existing = document.querySelector('.media-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = `media-notification media-notification-${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        requestAnimationFrame(() => notification.classList.add('show'));

        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 2000);
    }
};
