// Playback Speed Module - 재생 속도 조절

export const PlaybackSpeed = {
    video: null,
    currentSpeed: 1.0,
    speedDisplay: null,

    speeds: [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0],
    minSpeed: 0.25,
    maxSpeed: 2.0,
    step: 0.25,

    init(videoElement) {
        this.video = videoElement;
        this.createSpeedDisplay();
        console.log('[PlaybackSpeed] Initialized');
    },

    createSpeedDisplay() {
        this.speedDisplay = document.createElement('div');
        this.speedDisplay.id = 'speed-display';
        this.speedDisplay.className = 'speed-display';
        this.speedDisplay.textContent = '1.0x';

        document.getElementById('player-container')?.appendChild(this.speedDisplay);
    },

    setSpeed(speed) {
        if (!this.video) return;

        speed = Math.max(this.minSpeed, Math.min(this.maxSpeed, speed));
        this.currentSpeed = speed;
        this.video.playbackRate = speed;

        this.showSpeedIndicator(speed);
    },

    getSpeed() {
        return this.currentSpeed;
    },

    speedUp() {
        const newSpeed = Math.min(this.maxSpeed, this.currentSpeed + this.step);
        this.setSpeed(newSpeed);
    },

    speedDown() {
        const newSpeed = Math.max(this.minSpeed, this.currentSpeed - this.step);
        this.setSpeed(newSpeed);
    },

    reset() {
        this.setSpeed(1.0);
    },

    showSpeedIndicator(speed) {
        if (!this.speedDisplay) return;

        this.speedDisplay.textContent = speed.toFixed(2) + 'x';
        this.speedDisplay.classList.add('show');

        // 3초 후 숨김
        clearTimeout(this.hideTimeout);
        this.hideTimeout = setTimeout(() => {
            this.speedDisplay.classList.remove('show');
        }, 2000);
    },

    // 프리셋 속도로 설정
    setPresetSpeed(index) {
        if (index >= 0 && index < this.speeds.length) {
            this.setSpeed(this.speeds[index]);
        }
    },

    // 다음 프리셋 속도
    nextPreset() {
        const currentIndex = this.speeds.findIndex(s => s >= this.currentSpeed);
        const nextIndex = Math.min(currentIndex + 1, this.speeds.length - 1);
        this.setSpeed(this.speeds[nextIndex]);
    },

    // 이전 프리셋 속도
    prevPreset() {
        const currentIndex = this.speeds.findIndex(s => s >= this.currentSpeed);
        const prevIndex = Math.max(currentIndex - 1, 0);
        this.setSpeed(this.speeds[prevIndex]);
    }
};
