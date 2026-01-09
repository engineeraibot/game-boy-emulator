const WORKLET_QUEUE_SIZE = 4096;

class GameBoyAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(WORKLET_QUEUE_SIZE);
    this.bufferPtr = 0;
    this.isPlaying = false;
    this.port.onmessage = (e) => {
      this.enqueue(e.data);
    };
  }

  enqueue(samples) {
    if (this.bufferPtr + samples.length > WORKLET_QUEUE_SIZE) {
      // Not enough space, drop samples
      return;
    }
    this.buffer.set(samples, this.bufferPtr);
    this.bufferPtr += samples.length;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) {
      return true;
    }
    const left = output[0];
    const right = output.length > 1 ? output[1] : null;

    if (this.bufferPtr > 0) {
      const framesAvailable = Math.min(left.length, Math.floor(this.bufferPtr / 2));
      for (let i = 0; i < framesAvailable; i++) {
        const leftSample = this.buffer[i * 2];
        const rightSample = this.buffer[i * 2 + 1];
        if (right) {
          left[i] = leftSample;
          right[i] = rightSample;
        } else {
          left[i] = (leftSample + rightSample) * 0.5;
        }
      }
      for (let i = framesAvailable; i < left.length; i++) {
        left[i] = 0;
        if (right) {
          right[i] = 0;
        }
      }
      const consumed = framesAvailable * 2;
      this.buffer.copyWithin(0, consumed);
      this.bufferPtr -= consumed;
    } else {
        // silence
        for (let i = 0; i < left.length; i++) {
            left[i] = 0;
            if (right) {
              right[i] = 0;
            }
        }
    }

    return true;
  }
}

registerProcessor('gameboy-audio-processor', GameBoyAudioProcessor);
