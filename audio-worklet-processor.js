/**
 * Audio Worklet Processor for VAD
 * ================================
 * 고성능 오디오 처리를 위한 AudioWorklet
 * ScriptProcessor보다 효율적이며 메인 스레드 블로킹 없음
 */

class VADProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();

        this.frameSize = options.processorOptions?.frameSize || 512;
        this.frameBuffer = new Float32Array(this.frameSize);
        this.frameIndex = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0]) return true;

        const inputChannel = input[0];

        // 프레임 버퍼에 데이터 추가
        for (let i = 0; i < inputChannel.length; i++) {
            this.frameBuffer[this.frameIndex++] = inputChannel[i];

            // 프레임이 가득 차면 메인 스레드로 전송
            if (this.frameIndex >= this.frameSize) {
                this.port.postMessage({
                    audioData: new Float32Array(this.frameBuffer)
                });
                this.frameIndex = 0;
            }
        }

        // Pass-through (원본 오디오 유지)
        const output = outputs[0];
        if (output && output[0]) {
            output[0].set(inputChannel);
        }

        return true;
    }
}

registerProcessor('vad-processor', VADProcessor);
