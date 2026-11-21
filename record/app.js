import { formats, isFormatSupported, startRecording } from './audio.js?v=3';

const byId = (id) => document.getElementById(id);
const form = byId('source-form');
const sourceInput = byId('source-url');
const sourceError = byId('source-error');
const formatOptions = byId('format-options');
const startButton = byId('start');
const stopButton = byId('stop');
const openSource = byId('open-source');
const playSource = byId('play-source');
const sourcePlayer = byId('source-player');
const playback = byId('playback');
const saveLink = byId('save');
const progress = byId('progress');
const shareable = window.isSecureContext && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
const supportedFormats = new Set(formats.filter(({ id }) => isFormatSupported(id)).map(({ id }) => id));
const directExtension = /\.(mp3|wav|m4a|ogg|opus|aac|flac|mp4|webm)$/i;
const formatNotes = {
  wav: 'PCM 16-bit · khoảng 11,5 MB mỗi phút ở 48 kHz stereo.',
  m4a: 'AAC · file gọn, dễ mở trên các thiết bị Apple.',
  webm: 'Opus · file gọn, phát được trong Chrome.',
};
const statuses = {
  idle: 'Sẵn sàng',
  picking: 'Chờ chọn tab',
  preparing: 'Đang chuẩn bị bộ thu',
  loading: 'Đang mở tệp âm thanh',
  'waiting-play': 'Chờ phát nguồn',
  recording: 'Đang thu',
  processing: 'Đang tạo file',
  done: 'Đã thu xong',
};
const waitingForAudio = new Set(['loading', 'waiting-play']);
const captureHandle = registerCaptureHandle();

let state = 'idle';
let selectedFormat = supportedFormats.has('wav') ? 'wav' : supportedFormats.values().next().value;
let capture;
let result;
let captureError = '';
let openedUrl;
let sourceLinkUrl;
let externalFallback;

function registerCaptureHandle() {
  if (!shareable || typeof navigator.mediaDevices.setCaptureHandleConfig !== 'function') return;
  try {
    const handle = crypto.randomUUID();
    navigator.mediaDevices.setCaptureHandleConfig({ handle, permittedOrigins: [location.origin] });
    return handle;
  } catch {}
}

function text(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

function parseSource(value) {
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function isDirect(url) {
  return Boolean(captureHandle && url && directExtension.test(url.pathname) && externalFallback !== url.href);
}

function seconds(value) {
  const total = Math.max(0, Math.floor(value || 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function size(bytes) {
  const megabytes = bytes >= 1_000_000;
  const value = bytes / (megabytes ? 1_000_000 : 1_000);
  return `${new Intl.NumberFormat('vi', { maximumFractionDigits: 1 }).format(value)} ${megabytes ? 'MB' : 'KB'}`;
}

function updateFieldError(message = '') {
  text(sourceError, message);
  sourceError.hidden = !message;
  sourceInput.setAttribute('aria-invalid', String(Boolean(message)));
}

function renderFormats() {
  for (const format of formats) {
    const label = document.createElement('label');
    label.className = 'format-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'format';
    input.value = format.id;
    input.checked = format.id === selectedFormat;
    input.disabled = !supportedFormats.has(format.id);
    label.dataset.unavailable = String(input.disabled);
    const caption = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'format-name';
    name.textContent = format.label;
    const codec = document.createElement('span');
    codec.className = 'format-codec';
    codec.textContent = input.disabled ? 'Trình duyệt chưa hỗ trợ' : format.description;
    caption.append(name, codec);
    label.append(input, caption);
    formatOptions.append(label);
  }
}

function guidance() {
  if (!shareable) return 'Mở trang này bằng Chrome máy tính để chia sẻ âm thanh của tab.';
  if (!supportedFormats.size) return 'Chrome hiện tại chưa có định dạng thu âm được hỗ trợ.';
  if (state === 'picking') {
    return capture.direct
      ? 'Chọn tab Thu âm từ link · BaTip và bật Chia sẻ âm thanh của tab.'
      : `Chọn tab ${capture.url.hostname} và bật Chia sẻ âm thanh của tab.`;
  }
  if (state === 'recording') {
    return capture.direct ? 'Bản thu tự dừng khi nội dung phát hết.'
      : 'Bấm phát ở tab nguồn nếu cần. Khi xong, quay lại đây và bấm Dừng và lưu.';
  }
  if (state === 'waiting-play') return 'Bấm Phát nguồn để bắt đầu.';
  if (capture) return '';
  const url = parseSource(sourceInput.value);
  if (isDirect(url)) return 'Chia sẻ tab BaTip Audio. Bản thu tự dừng khi nội dung phát hết.';
  if (url && openedUrl === url.href) return 'Chọn tab nguồn đã mở. Bấm phát ở tab đó nếu cần.';
  return 'Với trang phát nhạc, chọn tab nguồn trong Chrome. Khi nội dung phát hết, bấm Dừng và lưu.';
}

function renderClock() {
  const direct = capture?.direct;
  const playerDuration = direct && sourcePlayer.duration;
  const total = playerDuration && Number.isFinite(playerDuration) ? playerDuration : 0;
  const elapsed = capture
    ? direct ? sourcePlayer.currentTime : (performance.now() - (capture.startedAt || performance.now())) / 1000
    : result?.duration || 0;
  text(byId('elapsed'), seconds(elapsed));
  byId('duration').hidden = !total;
  text(byId('duration'), total ? `/ ${seconds(total)}` : '');
  if (total) progress.value = Math.min(1, elapsed / total);
  else if (capture) progress.removeAttribute('value');
  else progress.value = result ? 1 : 0;
}

function renderSignal() {
  let label = '';
  if (state === 'recording') label = capture.signal ? 'Đã nhận âm thanh' : 'Đang chờ âm thanh';
  else if (state === 'done') label = result.signal ? 'Sẵn sàng nghe thử' : 'Chưa nhận thấy tín hiệu. Hãy nghe thử bản thu.';
  text(byId('signal-label'), label);
}

function render() {
  const active = Boolean(capture);
  const format = formats.find(({ id }) => id === (capture?.format || (state === 'done' && result?.format) || selectedFormat));
  byId('recording').dataset.state = state;
  text(byId('status'), statuses[state]);
  text(byId('output-format'), format?.label || 'WAV');
  text(byId('format-note'), formatNotes[selectedFormat] || '');
  text(byId('instructions'), guidance());
  sourceInput.readOnly = active;
  byId('format-fieldset').disabled = active;
  startButton.disabled = active || !shareable || !supportedFormats.has(selectedFormat);
  text(byId('start-label'), active ? statuses[state] : 'Bắt đầu thu');

  text(byId('capture-error'), captureError);
  byId('capture-error').hidden = !captureError;
  const showSource = !active && Boolean(sourceLinkUrl);
  openSource.hidden = !showSource;
  if (showSource) openSource.href = sourceLinkUrl;
  playSource.hidden = state !== 'waiting-play';
  stopButton.hidden = state !== 'recording' && !waitingForAudio.has(state);
  text(stopButton, state === 'recording' ? 'Dừng và lưu' : 'Hủy bản thu');
  byId('result').hidden = active || !result;
  renderClock();
  renderSignal();
}

function openTab(url) {
  let tab;
  try {
    tab = window.open('about:blank', '_blank');
    if (!tab) return false;
    tab.opener = null;
    tab.location.replace(url.href);
    openedUrl = url.href;
    return true;
  } catch {
    try { tab?.close(); } catch {}
    return false;
  }
}

function stopTracks(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function finishCapture(attempt) {
  clearInterval(attempt.clock);
  if (attempt.direct) {
    sourcePlayer.pause();
    sourcePlayer.removeAttribute('src');
    sourcePlayer.load();
  }
  stopTracks(attempt.stream);
  if (capture === attempt) {
    capture = undefined;
    state = result ? 'done' : 'idle';
    render();
  }
}

async function finish(attempt, discard = false) {
  if (capture !== attempt || !attempt.recorder || state === 'processing') return;
  state = 'processing';
  if (attempt.direct) sourcePlayer.pause();
  render();

  try {
    if (discard) {
      await attempt.recorder.discard();
      return;
    }
    const { blob, duration } = await attempt.recorder.stop();
    if (capture !== attempt) return;
    if (!blob.size || duration <= 0) throw new Error('Empty recording');
    const format = formats.find(({ id }) => id === attempt.format);
    const url = URL.createObjectURL(blob);
    if (result) URL.revokeObjectURL(result.url);
    result = { url, duration, signal: attempt.signal, format: attempt.format };
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', '-').replaceAll(':', '');
    playback.src = url;
    saveLink.href = url;
    saveLink.download = `batip-${timestamp}.${format.extension}`;
    text(byId('file-details'), `${format.label} · ${seconds(duration)} · ${size(blob.size)}`);
    saveLink.click();
  } catch {
    if (capture === attempt) captureError = 'Chưa tạo được file. Kiểm tra tab nguồn có đang phát và thử thu lại.';
  } finally {
    finishCapture(attempt);
  }
}

function cannotPlayDirect(attempt) {
  if (capture !== attempt || state === 'processing') return;
  externalFallback = attempt.url.href;
  sourceLinkUrl = attempt.url.href;
  captureError = 'Không phát được tệp ngay trong trang này. Mở tab nguồn, quay lại BaTip và bấm Bắt đầu thu.';
  void finish(attempt, true);
}

async function playDirect(attempt) {
  state = 'loading';
  render();
  const timeout = setTimeout(() => cannotPlayDirect(attempt), 18_000);
  try {
    await sourcePlayer.play();
    if (capture !== attempt || state === 'processing') return;
    state = 'recording';
    render();
  } catch (error) {
    if (capture !== attempt || state === 'processing') return;
    if (error.name === 'NotAllowedError') {
      state = 'waiting-play';
      render();
    } else {
      cannotPlayDirect(attempt);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function shareOptions(direct) {
  return {
    video: { displaySurface: 'browser', frameRate: { ideal: 1, max: 2 } },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
    systemAudio: 'exclude',
    windowAudio: 'exclude',
    surfaceSwitching: 'exclude',
    selfBrowserSurface: direct ? 'include' : 'exclude',
    monitorTypeSurfaces: 'exclude',
    preferCurrentTab: direct,
  };
}

function captureFailure(error, attempt) {
  if (error.name === 'NotAllowedError' && sourceLinkUrl) {
    return 'Mở tab nguồn nếu chưa có, rồi quay lại BaTip và bấm Bắt đầu thu để chọn tab.';
  }
  if (error.name === 'NotAllowedError') return 'Chrome chưa chia sẻ tab. Bấm Bắt đầu thu để thử lại.';
  if (error.name === 'InvalidStateError') return 'Quay lại tab BaTip và bấm Bắt đầu thu để chọn tab cần thu.';
  if (error.name === 'NotReadableError') return 'Chrome không đọc được tab. Kiểm tra quyền chia sẻ âm thanh trong Chrome rồi thử lại.';
  if (error.message) return error.message;
  return attempt.direct ? 'Chưa thu được tệp này. Thử lại từ đầu.' : 'Chưa thu được tab này. Thử chia sẻ lại tab nguồn.';
}

async function begin(url) {
  const attempt = { url, direct: isDirect(url), format: selectedFormat, signal: false };
  capture = attempt;
  state = 'picking';
  captureError = '';
  sourceLinkUrl = undefined;
  playback.pause();
  render();

  try {
    const pending = navigator.mediaDevices.getDisplayMedia(shareOptions(attempt.direct));
    if (!attempt.direct && openedUrl !== url.href) {
      const allowed = navigator.userActivation?.isActive !== false;
      if (!allowed || !openTab(url)) sourceLinkUrl = url.href;
    }
    attempt.stream = await pending;
    if (capture !== attempt) {
      stopTracks(attempt.stream);
      return;
    }
    const [video] = attempt.stream.getVideoTracks();
    if (video?.getSettings().displaySurface !== 'browser' || !attempt.stream.getAudioTracks().length) {
      throw new Error('Chọn đúng tab trong mục Tab Chrome và bật Chia sẻ âm thanh của tab.');
    }
    if (attempt.direct && video.getCaptureHandle?.()?.handle !== captureHandle) {
      throw new Error('Để tự phát và dừng đúng lúc, hãy chọn tab Thu âm từ link · BaTip trong Chrome.');
    }

    state = 'preparing';
    render();
    attempt.recorder = await startRecording(attempt.stream, attempt.format, {
      onLevel(peak) {
        if (capture === attempt && !attempt.signal && peak > 0.0005) {
          attempt.signal = true;
          renderSignal();
        }
      },
      onSourceEnded() {
        attempt.ended = true;
        if (capture === attempt && attempt.recorder) void finish(attempt, waitingForAudio.has(state));
      },
    });
    if (capture !== attempt) {
      await attempt.recorder.discard();
      return;
    }
    if (attempt.ended) {
      if (attempt.direct) captureError = 'Chia sẻ tab đã kết thúc trước khi tệp phát. Bấm Bắt đầu thu để thử lại.';
      await finish(attempt, attempt.direct);
      return;
    }
    attempt.startedAt = performance.now();
    attempt.clock = setInterval(renderClock, 250);
    if (attempt.direct) {
      sourcePlayer.src = url.href;
      await playDirect(attempt);
    } else {
      state = 'recording';
      render();
    }
  } catch (error) {
    if (capture === attempt) {
      captureError = captureFailure(error, attempt);
      if (!attempt.direct) sourceLinkUrl = url.href;
    }
    finishCapture(attempt);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (startButton.disabled) return;
  const url = parseSource(sourceInput.value);
  if (!url) {
    updateFieldError(sourceInput.value.trim() ? 'Nhập link hợp lệ bắt đầu bằng http:// hoặc https://.' : 'Dán link cần thu để bắt đầu.');
    sourceInput.focus();
    return;
  }
  updateFieldError();
  void begin(url);
});

sourceInput.addEventListener('input', () => {
  updateFieldError();
  captureError = '';
  sourceLinkUrl = undefined;
  render();
});
formatOptions.addEventListener('change', (event) => {
  if (event.target.name === 'format') {
    selectedFormat = event.target.value;
    render();
  }
});
openSource.addEventListener('click', () => {
  openedUrl = sourceLinkUrl;
});
playSource.addEventListener('click', () => {
  if (state === 'waiting-play') void playDirect(capture);
});
stopButton.addEventListener('click', () => {
  if (capture) void finish(capture, waitingForAudio.has(state));
});
sourcePlayer.addEventListener('ended', () => {
  if (capture?.direct) void finish(capture);
});
window.addEventListener('pagehide', () => {
  const attempt = capture;
  if (!attempt) return;
  if (attempt.recorder) void attempt.recorder.discard().catch(() => {});
  finishCapture(attempt);
});

renderFormats();
render();
