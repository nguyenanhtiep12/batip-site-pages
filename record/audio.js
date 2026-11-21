const nativeMimeTypes = new Map([
  ['m4a', 'audio/mp4;codecs=mp4a.40.2'],
  ['webm', 'audio/webm;codecs=opus'],
]);
const maximumSeconds = 30 * 60;

export const formats = [
  { id: 'wav', label: 'WAV', description: 'PCM 16-bit · 48 kHz · stereo', extension: 'wav' },
  { id: 'm4a', label: 'M4A', description: 'AAC · dung lượng nhỏ', extension: 'm4a' },
  { id: 'webm', label: 'WebM', description: 'Opus · dung lượng nhỏ', extension: 'webm' },
];

export function isFormatSupported(formatId) {
  if (typeof globalThis.AudioContext !== 'function') return false;
  if (formatId === 'wav') return typeof globalThis.AudioWorkletNode === 'function';
  const mimeType = nativeMimeTypes.get(formatId);
  return Boolean(mimeType && globalThis.MediaRecorder?.isTypeSupported(mimeType));
}

function makeWav(chunks, sampleRate, channels, byteLength) {
  if (byteLength > 0xffffffff - 36) throw new Error('Bản thu vượt giới hạn dung lượng của WAV.');

  const header = new DataView(new ArrayBuffer(44));
  const blockAlign = channels * 2;
  header.setUint32(0, 0x52494646); // RIFF
  header.setUint32(4, 36 + byteLength, true);
  header.setUint32(8, 0x57415645); // WAVE
  header.setUint32(12, 0x666d7420); // "fmt "
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, channels, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * blockAlign, true);
  header.setUint16(32, blockAlign, true);
  header.setUint16(34, 16, true);
  header.setUint32(36, 0x64617461); // data
  header.setUint32(40, byteLength, true);
  return new Blob([header.buffer, ...chunks], { type: 'audio/wav' });
}

async function startWav(context, source, onEnd) {
  const channels = 2;
  await context.audioWorklet.addModule(new URL('./pcm-worklet.js?v=3', import.meta.url));
  const worklet = new AudioWorkletNode(context, 'pcm-recorder', {
    channelCount: channels,
    channelCountMode: 'explicit',
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { framesRemaining: Math.floor(context.sampleRate * maximumSeconds) },
  });

  const chunks = [];
  let byteLength = 0;
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  done.catch(() => {});

  worklet.port.onmessage = ({ data }) => {
    if (data.type === 'pcm') {
      chunks.push(data.buffer);
      byteLength += data.buffer.byteLength;
    } else if (data.type === 'done') {
      resolveDone();
      if (data.limitReached) onEnd();
    }
  };
  worklet.onprocessorerror = () => {
    rejectDone(new Error('Bộ xử lý WAV gặp lỗi trong lúc thu.'));
    onEnd();
  };

  source.connect(worklet);
  // The worklet emits silence. The connection keeps the processing graph running.
  worklet.connect(context.destination);

  return async () => {
    worklet.port.postMessage('finish');
    const timeout = setTimeout(() => rejectDone(new Error('Không thể kết thúc luồng âm thanh WAV.')), 3000);
    try {
      await done;
      return {
        blob: makeWav(chunks, context.sampleRate, channels, byteLength),
        duration: byteLength / (context.sampleRate * channels * 2),
      };
    } finally {
      clearTimeout(timeout);
      source.disconnect(worklet);
      worklet.disconnect();
      worklet.port.close();
    }
  };
}

function startNative(stream, mimeType, onEnd) {
  const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 256000 });
  const chunks = [];
  let startedAt = performance.now();
  let stoppedAt;
  const done = new Promise((resolve, reject) => {
    recorder.onstart = event => { startedAt = event.timeStamp; };
    recorder.ondataavailable = event => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onerror = event => {
      reject(event.error || new Error('Chrome gặp lỗi trong lúc thu.'));
      onEnd();
    };
    recorder.onstop = event => {
      resolve({ blob: new Blob(chunks, { type: recorder.mimeType || mimeType }),
        duration: Math.max(0, ((stoppedAt ?? event.timeStamp) - startedAt) / 1000) });
      onEnd();
    };
  });
  done.catch(() => {});
  recorder.start(1000);

  return () => {
    if (recorder.state !== 'inactive') {
      stoppedAt = performance.now();
      recorder.stop();
    }
    return done;
  };
}

function startMeter(context, source, onLevel) {
  if (!onLevel) return;

  const splitter = context.createChannelSplitter(2);
  const meters = [context.createAnalyser(), context.createAnalyser()];
  const samples = new Float32Array(1024);
  source.connect(splitter);
  meters.forEach((meter, index) => {
    meter.fftSize = samples.length;
    splitter.connect(meter, index);
  });

  return setInterval(() => {
    let peak = 0;
    for (const meter of meters) {
      meter.getFloatTimeDomainData(samples);
      for (const value of samples) peak = Math.max(peak, Math.abs(value));
    }
    onLevel(Math.min(peak, 1));
  }, 80);
}

export async function startRecording(displayStream, formatId, { onLevel, onSourceEnded } = {}) {
  const tracks = displayStream.getTracks();
  let context;
  let meter;
  let limit;
  let finish;
  let result;

  const release = async () => {
    clearInterval(meter);
    clearTimeout(limit);
    for (const track of tracks) {
      track.removeEventListener('ended', handleEnd);
      track.stop();
    }
    if (context && context.state !== 'closed') await context.close().catch(() => {});
  };

  const stop = () => {
    result ??= Promise.resolve().then(finish).finally(release);
    return result;
  };

  function handleEnd() {
    if (result) return;
    stop().catch(() => {});
    onSourceEnded?.();
  }

  try {
    const [audio] = displayStream.getAudioTracks();
    if (audio?.readyState !== 'live') throw new Error('Chọn tab Chrome và bật chia sẻ âm thanh của tab.');
    if (!isFormatSupported(formatId)) throw new Error('Chrome hiện tại không hỗ trợ định dạng này.');

    const stream = new MediaStream([audio]);
    context = new AudioContext(formatId === 'wav' ? { sampleRate: 48000 } : undefined);
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    finish = formatId === 'wav'
      ? await startWav(context, source, handleEnd)
      : startNative(stream, nativeMimeTypes.get(formatId), handleEnd);
    meter = startMeter(context, source, onLevel);
    limit = setTimeout(handleEnd, maximumSeconds * 1000);
    for (const track of tracks) track.addEventListener('ended', handleEnd, { once: true });
    if (tracks.some(track => track.readyState === 'ended')) setTimeout(handleEnd, 0);

    return {
      stop,
      discard: async () => { await stop(); },
    };
  } catch (error) {
    await release();
    throw error;
  }
}
