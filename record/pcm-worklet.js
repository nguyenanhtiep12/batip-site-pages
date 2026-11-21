class PcmRecorder extends AudioWorkletProcessor {
  constructor({ processorOptions } = {}) {
    super();
    // 4096 interleaved stereo frames, or about 85 ms at 48 kHz.
    this.chunkSize = 4096 * 4;
    this.chunk = new DataView(new ArrayBuffer(this.chunkSize));
    this.offset = 0;
    this.finished = false;
    this.framesRemaining = processorOptions?.framesRemaining ?? Infinity;

    this.port.onmessage = ({ data }) => {
      if (data === 'finish') this.finish(false);
    };
  }

  finish(limitReached) {
    if (this.finished) return;
    this.finished = true;
    this.flush();
    this.port.postMessage({ type: 'done', limitReached });
  }

  flush() {
    if (!this.offset) return;

    const buffer = this.offset === this.chunkSize
      ? this.chunk.buffer
      : this.chunk.buffer.slice(0, this.offset);
    this.port.postMessage({ type: 'pcm', buffer }, [buffer]);
    this.chunk = new DataView(new ArrayBuffer(this.chunkSize));
    this.offset = 0;
  }

  write(sample) {
    const value = Math.max(-1, Math.min(1, sample));
    this.chunk.setInt16(this.offset, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    this.offset += 2;
  }

  process(inputs) {
    if (this.finished) return false;

    const [left, right = left] = inputs[0];
    if (!left) return true;

    const frames = Math.min(this.framesRemaining, left.length);
    for (let index = 0; index < frames; index += 1) {
      this.write(left[index]);
      this.write(right[index]);
      if (this.offset === this.chunkSize) this.flush();
    }
    this.framesRemaining -= frames;
    if (this.framesRemaining === 0) {
      this.finish(true);
      return false;
    }
    return true;
  }
}

registerProcessor('pcm-recorder', PcmRecorder);
