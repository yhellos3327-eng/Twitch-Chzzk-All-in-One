export const AudioEnhancer = {
    settings: { enabled: false, boost: 100, compressor: false, eq: [0, 0, 0, 0, 0] },
    elements: {},
    context: null, source: null, gainNode: null, compressor: null, eqBands: [],
    freqs: [60, 250, 1000, 4000, 12000],

    init() {
        this.elements = {
            toggle: document.getElementById('audio-toggle'),
            boost: document.getElementById('audio-boost-slider'),
            compressor: document.getElementById('compressor-toggle'),
            eq: Array.from(document.querySelectorAll('.eq-slider')),
            reset: document.getElementById('reset-audio-btn'),
            boostVal: document.getElementById('audio-boost-value')
        };
        const saved = localStorage.getItem('audioEnhancementSettings');
        if (saved) try { this.settings = { ...this.settings, ...JSON.parse(saved) }; } catch (e) { }
        this.updateUI();
        this.setupListeners();
    },

    updateUI() {
        if (this.elements.toggle) this.elements.toggle.checked = this.settings.enabled;
        if (this.elements.boost) this.elements.boost.value = this.settings.boost;
        if (this.elements.compressor) this.elements.compressor.checked = this.settings.compressor;
        if (this.elements.boostVal) this.elements.boostVal.textContent = this.settings.boost + '%';
        this.elements.eq.forEach((el, i) => el.value = this.settings.eq[i]);
    },

    setupListeners() {
        const update = () => {
            this.updateNodes();
            localStorage.setItem('audioEnhancementSettings', JSON.stringify(this.settings));
        };

        if (this.elements.toggle) {
            this.elements.toggle.addEventListener('change', e => {
                this.settings.enabled = e.target.checked;
                update();
            });
        }
        if (this.elements.boost) {
            this.elements.boost.addEventListener('input', e => {
                this.settings.boost = parseInt(e.target.value);
                if (this.elements.boostVal) this.elements.boostVal.textContent = this.settings.boost + '%';
                update();
            });
        }
        if (this.elements.compressor) {
            this.elements.compressor.addEventListener('change', e => {
                this.settings.compressor = e.target.checked;
                update();
            });
        }
        this.elements.eq.forEach((el, i) => {
            el.addEventListener('input', e => {
                this.settings.eq[i] = parseInt(e.target.value);
                update();
            });
        });
        if (this.elements.reset) {
            this.elements.reset.addEventListener('click', () => {
                this.settings = { enabled: false, boost: 100, compressor: false, eq: [0, 0, 0, 0, 0] };
                this.updateUI();
                update();
            });
        }
    },

    setupContext() {
        if (this.context && this.context.state !== 'closed') return;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            this.context = new AC();

            const video = document.getElementById('video-player');
            if (video && !video.crossOrigin) video.crossOrigin = 'anonymous';

            this.source = this.context.createMediaElementSource(video);

            const resumeCtx = () => {
                if (this.context && this.context.state === 'suspended') {
                    this.context.resume().then(() => console.log('[Audio] Resumed'));
                }
            };
            ['click', 'touchstart', 'keydown', 'play'].forEach(evt => {
                document.addEventListener(evt, resumeCtx, { once: true, capture: true });
                if (evt === 'play' && video) video.addEventListener('play', resumeCtx);
            });

        } catch (e) { console.error('[Audio] Setup failed', e); return; }

        this.gainNode = this.context.createGain();
        this.compressor = this.context.createDynamicsCompressor();
        this.eqBands = this.freqs.map(f => {
            const bf = this.context.createBiquadFilter();
            bf.type = 'peaking'; bf.frequency.value = f; bf.Q.value = 1; bf.gain.value = 0;
            return bf;
        });

        // Chain: Source -> EQ -> Compressor -> Gain -> Dest
        let node = this.source;
        this.eqBands.forEach(b => { node.connect(b); node = b; });
        node.connect(this.compressor);
        this.compressor.connect(this.gainNode);
        this.gainNode.connect(this.context.destination);
    },

    updateNodes() {
        if (!this.context) {
            if (this.settings.enabled) this.setupContext();
            else return;
        }
        if (this.context && this.context.state === 'suspended') this.context.resume();
        if (!this.context) return;

        if (!this.settings.enabled) {
            this.gainNode.gain.value = 1;
            this.eqBands.forEach(b => b.gain.value = 0);
            this.compressor.threshold.value = 0;
            this.compressor.ratio.value = 1;
            return;
        }

        this.gainNode.gain.value = this.settings.boost / 100;
        this.eqBands.forEach((b, i) => b.gain.value = this.settings.eq[i]);

        if (this.settings.compressor) {
            this.compressor.threshold.value = -24;
            this.compressor.ratio.value = 12;
        } else {
            this.compressor.threshold.value = 0;
            this.compressor.ratio.value = 1;
        }
    }
};
