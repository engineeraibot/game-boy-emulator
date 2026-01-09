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
    const left = output[0];
    const right = output[1];

    if (this.bufferPtr > 0) {
      for (let i = 0; i < left.length && i * 2 < this.bufferPtr; i++) {
        left[i] = this.buffer[i * 2];
        right[i] = this.buffer[i * 2 + 1];
      }
      const consumed = Math.min(this.bufferPtr, left.length * 2);
      this.buffer.copyWithin(0, consumed);
      this.bufferPtr -= consumed;
    } else {
        // silence
        for (let i = 0; i < left.length; i++) {
            left[i] = 0;
            right[i] = 0;
        }
    }

    return true;
  }
}

registerProcessor('gameboy-audio-processor', GameBoyAudioProcessor);
