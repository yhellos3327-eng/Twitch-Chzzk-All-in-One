export const AudioEnhancer = {
    settings: { enabled: false, boost: 100, compressor: false, eq: [0, 0, 0, 0, 0] },
    elements: {},
    context: null,
    source: null,
    gainNode: null,
    compressor: null,
    eqBands: [],
    freqs: [60, 250, 1000, 4000, 12000],
    isInitialized: false,
    sourceConnected: false,

    init() {
        this.elements = {
            toggle: document.getElementById('audio-toggle'),
            boost: document.getElementById('audio-boost-slider'),
            compressor: document.getElementById('compressor-toggle'),
            eq: Array.from(document.querySelectorAll('.eq-slider')),
            reset: document.getElementById('reset-audio-btn'),
            boostVal: document.getElementById('audio-boost-value')
        };

        // Load saved settings
        const saved = localStorage.getItem('audioEnhancementSettings');
        if (saved) {
            try {
                this.settings = { ...this.settings, ...JSON.parse(saved) };
            } catch (e) {
                console.warn('[Audio] Failed to load saved settings:', e);
            }
        }

        this.updateUI();
        this.setupListeners();
        this.isInitialized = true;

        console.log('[Audio] AudioEnhancer initialized');
    },

    updateUI() {
        if (this.elements.toggle) this.elements.toggle.checked = this.settings.enabled;
        if (this.elements.boost) this.elements.boost.value = this.settings.boost;
        if (this.elements.compressor) this.elements.compressor.checked = this.settings.compressor;
        if (this.elements.boostVal) this.elements.boostVal.textContent = this.settings.boost + '%';
        this.elements.eq.forEach((el, i) => {
            if (el && this.settings.eq[i] !== undefined) {
                el.value = this.settings.eq[i];
            }
        });
    },

    setupListeners() {
        const update = () => {
            this.updateNodes();
            this.saveSettings();
        };

        if (this.elements.toggle) {
            this.elements.toggle.addEventListener('change', e => {
                this.settings.enabled = e.target.checked;
                if (this.settings.enabled) {
                    this.setupContext();
                }
                update();
            });
        }

        if (this.elements.boost) {
            this.elements.boost.addEventListener('input', e => {
                this.settings.boost = parseInt(e.target.value);
                if (this.elements.boostVal) {
                    this.elements.boostVal.textContent = this.settings.boost + '%';
                }
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
            if (el) {
                el.addEventListener('input', e => {
                    this.settings.eq[i] = parseInt(e.target.value);
                    update();
                });
            }
        });

        if (this.elements.reset) {
            this.elements.reset.addEventListener('click', () => {
                this.resetSettings();
            });
        }
    },

    saveSettings() {
        try {
            localStorage.setItem('audioEnhancementSettings', JSON.stringify(this.settings));
        } catch (e) {
            console.warn('[Audio] Failed to save settings:', e);
        }
    },

    resetSettings() {
        this.settings = { enabled: false, boost: 100, compressor: false, eq: [0, 0, 0, 0, 0] };
        this.updateUI();
        this.updateNodes();
        this.saveSettings();
        console.log('[Audio] Settings reset');
    },

    setupContext() {
        // Prevent multiple context creation
        if (this.context && this.context.state !== 'closed') {
            console.log('[Audio] Context already exists, resuming if needed');
            if (this.context.state === 'suspended') {
                this.context.resume().then(() => console.log('[Audio] Context resumed'));
            }
            return true;
        }

        try {
            const video = document.getElementById('video-player');
            if (!video) {
                console.warn('[Audio] Video element not found');
                return false;
            }

            // Create AudioContext
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) {
                console.error('[Audio] AudioContext not supported');
                return false;
            }

            this.context = new AC();
            console.log('[Audio] AudioContext created, state:', this.context.state);

            // Only create MediaElementSource once
            if (!this.sourceConnected) {
                try {
                    this.source = this.context.createMediaElementSource(video);
                    this.sourceConnected = true;
                    console.log('[Audio] MediaElementSource created');
                } catch (e) {
                    // Source might already be connected to another context
                    console.error('[Audio] Failed to create MediaElementSource:', e.message);

                    // If already connected, try to use existing audio path
                    if (e.name === 'InvalidStateError') {
                        console.warn('[Audio] Video already connected to another AudioContext');
                        return false;
                    }
                    return false;
                }
            }

            // Create audio nodes
            this.gainNode = this.context.createGain();
            this.compressorNode = this.context.createDynamicsCompressor();

            // Create EQ bands
            this.eqBands = this.freqs.map(f => {
                const filter = this.context.createBiquadFilter();
                filter.type = 'peaking';
                filter.frequency.value = f;
                filter.Q.value = 1;
                filter.gain.value = 0;
                return filter;
            });

            // Build audio chain: Source -> EQ -> Compressor -> Gain -> Destination
            let currentNode = this.source;

            this.eqBands.forEach(band => {
                currentNode.connect(band);
                currentNode = band;
            });

            currentNode.connect(this.compressorNode);
            this.compressorNode.connect(this.gainNode);
            this.gainNode.connect(this.context.destination);

            console.log('[Audio] Audio chain connected');

            // Setup user interaction to resume context
            this.setupContextResume();

            return true;

        } catch (e) {
            console.error('[Audio] Setup failed:', e);
            return false;
        }
    },

    setupContextResume() {
        const resumeContext = () => {
            if (this.context && this.context.state === 'suspended') {
                this.context.resume().then(() => {
                    console.log('[Audio] Context resumed via user interaction');
                }).catch(e => {
                    console.warn('[Audio] Failed to resume context:', e);
                });
            }
        };

        // Listen for user interaction events
        const events = ['click', 'touchstart', 'keydown'];
        events.forEach(evt => {
            document.addEventListener(evt, resumeContext, { once: true, capture: true });
        });

        // Also listen on video play
        const video = document.getElementById('video-player');
        if (video) {
            video.addEventListener('play', resumeContext, { once: true });
        }
    },

    updateNodes() {
        // If not enabled, reset all effects but keep connections
        if (!this.settings.enabled) {
            if (this.gainNode) {
                this.gainNode.gain.setValueAtTime(1, this.context?.currentTime || 0);
            }
            if (this.eqBands) {
                this.eqBands.forEach(b => {
                    if (b) b.gain.setValueAtTime(0, this.context?.currentTime || 0);
                });
            }
            if (this.compressorNode) {
                this.compressorNode.threshold.setValueAtTime(0, this.context?.currentTime || 0);
                this.compressorNode.ratio.setValueAtTime(1, this.context?.currentTime || 0);
            }
            return;
        }

        // Setup context if not already done
        if (!this.context || this.context.state === 'closed') {
            if (!this.setupContext()) {
                console.warn('[Audio] Could not setup audio context');
                return;
            }
        }

        // Resume if suspended
        if (this.context && this.context.state === 'suspended') {
            this.context.resume();
        }

        // Apply settings
        const currentTime = this.context?.currentTime || 0;

        // Volume boost (convert percentage to gain value)
        if (this.gainNode) {
            const gainValue = this.settings.boost / 100;
            this.gainNode.gain.setValueAtTime(gainValue, currentTime);
        }

        // EQ bands
        if (this.eqBands) {
            this.eqBands.forEach((band, i) => {
                if (band && this.settings.eq[i] !== undefined) {
                    band.gain.setValueAtTime(this.settings.eq[i], currentTime);
                }
            });
        }

        // Compressor
        if (this.compressorNode) {
            if (this.settings.compressor) {
                this.compressorNode.threshold.setValueAtTime(-24, currentTime);
                this.compressorNode.knee.setValueAtTime(30, currentTime);
                this.compressorNode.ratio.setValueAtTime(12, currentTime);
                this.compressorNode.attack.setValueAtTime(0.003, currentTime);
                this.compressorNode.release.setValueAtTime(0.25, currentTime);
            } else {
                this.compressorNode.threshold.setValueAtTime(0, currentTime);
                this.compressorNode.ratio.setValueAtTime(1, currentTime);
            }
        }

        console.log('[Audio] Nodes updated - Boost:', this.settings.boost + '%',
                    'Compressor:', this.settings.compressor,
                    'EQ:', this.settings.eq);
    },

    // Public method to manually trigger context setup (call after video is ready)
    activate() {
        if (this.settings.enabled) {
            this.setupContext();
            this.updateNodes();
        }
    },

    // Cleanup method
    destroy() {
        if (this.context && this.context.state !== 'closed') {
            this.context.close().then(() => {
                console.log('[Audio] Context closed');
            });
        }
        this.context = null;
        this.source = null;
        this.gainNode = null;
        this.compressorNode = null;
        this.eqBands = [];
        this.sourceConnected = false;
    }
};
