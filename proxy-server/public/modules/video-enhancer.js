export const VideoEnhancer = {
    settings: {
        enabled: false,
        mode: 'default',
        sharpness: 1,
        saturation: 1,
        contrast: 100,
        brightness: 100
    },
    elements: {},

    init() {
        this.elements = {
            toggle: document.getElementById('enhancement-toggle'),
            modeSelect: document.getElementById('filter-mode-select'),
            sharpness: document.getElementById('sharpness-slider'),
            saturation: document.getElementById('saturation-slider'),
            contrast: document.getElementById('contrast-slider'),
            brightness: document.getElementById('brightness-slider'),
            matrix: document.getElementById('sharpness-matrix'),
            colorMatrix: document.getElementById('color-matrix'),
            reset: document.getElementById('reset-settings-btn')
        };

        const saved = localStorage.getItem('videoEnhancementSettings');
        if (saved) {
            try { this.settings = { ...this.settings, ...JSON.parse(saved) }; } catch (e) { }
        }

        this.updateUI();
        this.setupListeners();
        this.applyFilters();
    },

    updateUI() {
        if (this.elements.toggle) this.elements.toggle.checked = this.settings.enabled;
        if (this.elements.modeSelect) this.elements.modeSelect.value = this.settings.mode;
        if (this.elements.sharpness) this.elements.sharpness.value = this.settings.sharpness;
        if (this.elements.saturation) this.elements.saturation.value = this.settings.saturation;
        if (this.elements.contrast) this.elements.contrast.value = this.settings.contrast;
        if (this.elements.brightness) this.elements.brightness.value = this.settings.brightness;
        this.updateLabels();
    },

    updateLabels() {
        const setLabel = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };
        setLabel('sharpness-value', this.settings.sharpness + 'x');
        setLabel('saturation-value', this.settings.saturation + 'x');
        setLabel('contrast-value', this.settings.contrast + '%');
        setLabel('brightness-value', this.settings.brightness + '%');
    },

    setupListeners() {
        if (this.elements.toggle) {
            this.elements.toggle.addEventListener('change', e => {
                this.settings.enabled = e.target.checked;
                this.applyFilters();
                this.saveSettings();
            });
        }
        if (this.elements.modeSelect) {
            this.elements.modeSelect.addEventListener('change', e => this.setMode(e.target.value));
            ['click', 'mousedown'].forEach(evt =>
                this.elements.modeSelect.addEventListener(evt, e => e.stopPropagation())
            );
        }

        ['sharpness', 'saturation', 'contrast', 'brightness'].forEach(key => {
            const el = this.elements[key];
            if (el) {
                el.addEventListener('input', e => {
                    this.settings[key] = parseFloat(e.target.value);
                    this.updateLabels();
                    this.applyFilters();
                    this.saveSettings();
                });
            }
        });

        if (this.elements.reset) {
            this.elements.reset.addEventListener('click', () => {
                this.setMode('default');
                this.settings.enabled = false;
                this.updateUI();
                this.applyFilters();
                this.saveSettings();
            });
        }
    },

    setMode(mode) {
        this.settings.mode = mode;
        if (mode === 'default') {
            this.settings.sharpness = 1;
            this.settings.saturation = 1;
            this.settings.contrast = 100;
            this.settings.brightness = 100;
        } else if (mode === 'natural') {
            this.settings.sharpness = 1.2;
            this.settings.saturation = 1.2;
            this.settings.contrast = 105;
            this.settings.brightness = 100;
        }
        this.updateUI();
        this.applyFilters();
        this.saveSettings();
    },

    saveSettings() {
        localStorage.setItem('videoEnhancementSettings', JSON.stringify(this.settings));
    },

    applyFilters() {
        const video = document.getElementById('video-player');
        if (!video) return;

        if (!this.settings.enabled) {
            video.style.filter = '';
            video.classList.remove('video-enhanced');
            video.style.removeProperty('--contrast');
            video.style.removeProperty('--brightness');
            return;
        }

        const k = this.settings.sharpness;
        const off = -((k - 1) / 4);
        const matrix = `0 ${off} 0 ${off} ${k} ${off} 0 ${off} 0`;
        if (this.elements.matrix) this.elements.matrix.setAttribute('kernelMatrix', matrix);
        if (this.elements.colorMatrix) this.elements.colorMatrix.setAttribute('values', this.settings.saturation);

        // video-enhanced 클래스가 CSS 필터를 적용해야 함 (url(#sharpen))
        video.classList.add('video-enhanced');
        video.style.setProperty('--contrast', `${this.settings.contrast}%`);
        video.style.setProperty('--brightness', `${this.settings.brightness}%`);
    }
};
