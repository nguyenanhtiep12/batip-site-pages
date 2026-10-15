export const MORSE_BY_TEXT = Object.freeze({
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  0: '-----',
  1: '.----',
  2: '..---',
  3: '...--',
  4: '....-',
  5: '.....',
  6: '-....',
  7: '--...',
  8: '---..',
  9: '----.',
  '.': '.-.-.-',
  ',': '--..--',
  '?': '..--..',
  "'": '.----.',
  '!': '-.-.--',
  '/': '-..-.',
  '(': '-.--.',
  ')': '-.--.-',
  '&': '.-...',
  ':': '---...',
  ';': '-.-.-.',
  '=': '-...-',
  '+': '.-.-.',
  '-': '-....-',
  _: '..--.-',
  '"': '.-..-.',
  $: '...-..-',
  '@': '.--.-.',
});

const TEXT_BY_MORSE = Object.freeze(
  Object.fromEntries(Object.entries(MORSE_BY_TEXT).map(([character, morse]) => [morse, character])),
);
const SPECIAL_CONTINUOUS_SIGNALS = Object.freeze({
  '...---...': 'SOS',
});

export function encodeText(input) {
  const normalized = String(input || '').trim();
  if (!normalized) {
    return { output: '', unsupported: [] };
  }

  const unsupported = new Set();
  const words = normalized.split(/\s+/u).map((word) => (
    [...word].map((character) => {
      // Only ASCII case folding belongs to the supported A-Z alphabet.
      // Unicode uppercasing can silently turn unsupported input into letters.
      const key = /^[a-z]$/.test(character) ? character.toUpperCase() : character;
      const morse = MORSE_BY_TEXT[key];
      if (morse) return morse;
      unsupported.add(character);
      return '?';
    }).join(' ')
  ));

  return {
    output: words.join('   '),
    unsupported: [...unsupported],
  };
}

export function normalizeMorseInput(input) {
  return String(input || '')
    .replaceAll('·', '.')
    .replaceAll('•', '.')
    .replaceAll('–', '-')
    .replaceAll('—', '-')
    .replaceAll('−', '-')
    .replaceAll('|', '/');
}

export function decodeMorse(input) {
  const tokens = tokenizeMorse(input);
  if (!tokens.length) {
    return { output: '', unsupported: [] };
  }

  const unsupported = new Set();
  let output = '';
  let lastWasSpace = true;

  for (const token of tokens) {
    if (token === null) {
      if (!lastWasSpace && output) {
        output += ' ';
        lastWasSpace = true;
      }
      continue;
    }

    const character = TEXT_BY_MORSE[token] || SPECIAL_CONTINUOUS_SIGNALS[token];
    if (character) {
      output += character;
    } else {
      output += '?';
      unsupported.add(token);
    }
    lastWasSpace = false;
  }

  return {
    output: output.trim(),
    unsupported: [...unsupported],
  };
}

function tokenizeMorse(input) {
  const normalized = normalizeMorseInput(input);
  const tokens = [];
  let token = '';

  const flushToken = () => {
    if (!token) return;
    tokens.push(token);
    token = '';
  };
  const addWordGap = () => {
    flushToken();
    if (!tokens.length || tokens[tokens.length - 1] === null) return;
    tokens.push(null);
  };

  let index = 0;
  while (index < normalized.length) {
    const character = normalized[index];

    if (character === '/') {
      addWordGap();
      index += 1;
      continue;
    }

    if (/\s/u.test(character)) {
      flushToken();
      let whitespaceCount = 0;
      while (index < normalized.length && /\s/u.test(normalized[index])) {
        whitespaceCount += 1;
        index += 1;
      }
      if (whitespaceCount >= 3) addWordGap();
      continue;
    }

    token += character;
    index += 1;
  }

  flushToken();
  while (tokens[0] === null) tokens.shift();
  while (tokens[tokens.length - 1] === null) tokens.pop();
  return tokens;
}

function initializeMorseConverter(root) {
  const modeButtons = [...root.querySelectorAll('[data-morse-mode]')];
  const input = root.querySelector('[data-morse-input]');
  const output = root.querySelector('[data-morse-output]');
  const inputLabel = root.querySelector('[data-morse-input-label]');
  const outputLabel = root.querySelector('[data-morse-output-label]');
  const status = root.querySelector('[data-morse-status]');
  const copyButton = root.querySelector('[data-morse-copy]');
  const swapButton = root.querySelector('[data-morse-swap]');
  const clearButton = root.querySelector('[data-morse-clear]');
  const convertButton = root.querySelector('[data-morse-convert]');
  let mode = 'encode';

  const labels = root.dataset;
  const updateMode = (nextMode, { keepInput = true } = {}) => {
    mode = nextMode === 'decode' ? 'decode' : 'encode';
    for (const button of modeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.morseMode === mode));
    }

    if (!keepInput) input.value = '';
    inputLabel.textContent = mode === 'encode' ? labels.textInputLabel : labels.morseInputLabel;
    outputLabel.textContent = mode === 'encode' ? labels.morseOutputLabel : labels.textOutputLabel;
    input.placeholder = mode === 'encode' ? labels.textPlaceholder : labels.morsePlaceholder;
    runConversion();
  };

  const runConversion = () => {
    const result = mode === 'encode' ? encodeText(input.value) : decodeMorse(input.value);
    output.value = result.output;
    copyButton.disabled = !result.output;

    if (!input.value.trim()) {
      status.textContent = labels.emptyStatus;
      return;
    }

    if (result.unsupported.length) {
      const prefix = mode === 'encode'
        ? labels.unsupportedTextPrefix
        : labels.unsupportedMorsePrefix;
      status.textContent = `${prefix} ${result.unsupported.join(', ')}`;
      return;
    }

    status.textContent = labels.readyStatus;
  };

  for (const button of modeButtons) {
    button.addEventListener('click', () => updateMode(button.dataset.morseMode));
  }
  input.addEventListener('input', runConversion);
  convertButton.addEventListener('click', runConversion);
  clearButton.addEventListener('click', () => {
    input.value = '';
    output.value = '';
    status.textContent = labels.emptyStatus;
    copyButton.disabled = true;
    input.focus();
  });
  swapButton.addEventListener('click', () => {
    const previousOutput = output.value;
    updateMode(mode === 'encode' ? 'decode' : 'encode', { keepInput: false });
    input.value = previousOutput;
    runConversion();
    input.focus();
  });
  copyButton.addEventListener('click', async () => {
    if (!output.value) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(output.value);
      } else {
        output.focus();
        output.select();
        if (!document.execCommand('copy')) throw new Error('copy unavailable');
      }
      status.textContent = labels.copySuccess;
    } catch {
      output.focus();
      output.select();
      status.textContent = labels.copyFailure;
    }
  });

  updateMode('encode');
}

if (typeof document !== 'undefined') {
  for (const root of document.querySelectorAll('[data-morse-converter]')) {
    initializeMorseConverter(root);
  }
}
