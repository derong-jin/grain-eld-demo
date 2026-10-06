'use strict';

// Browser Web Worker for one-time grain preprocessing.
//
// Inbound:
//   { type: 'init', settings, noiseProfile }
//   { type: 'process', jobId, sampleRate, channels: [ArrayBuffer, ...] }
//
// Outbound:
//   { type: 'ready' }
//   { type: 'result', jobId, channels: [ArrayBuffer, ...], rmsDbfs }
//   { type: 'error', jobId, message }

const EPSILON = 1e-12;
const DEFAULT_FFT_SIZE = 1024;
const DEFAULT_SETTINGS = Object.freeze({
  windowKind: 'none',
  windowAlpha: 0.25,
  denoiseKind: 'none',
  denoiseStrength: 1,
  denoiseMaxAttenDb: 18,
});
const WINDOW_KINDS = new Set(['none', 'tukey', 'hann']);
const DENOISE_KINDS = new Set(['none', 'spectral']);

let workerState = null;

function fail(message) {
  throw new Error(message);
}

function requireFiniteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) fail(`${name} must be finite`);
  return number;
}

function requireInteger(value, name, minimum = 1) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) {
    fail(`${name} must be an integer >= ${minimum}`);
  }
  return number;
}

function isPowerOfTwo(value) {
  return Number.isSafeInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function normalizeSettings(input) {
  const settings = { ...DEFAULT_SETTINGS, ...(input || {}) };
  if (!WINDOW_KINDS.has(settings.windowKind)) {
    fail(`unsupported grain window: ${String(settings.windowKind)}`);
  }
  if (!DENOISE_KINDS.has(settings.denoiseKind)) {
    fail(`unsupported grain denoise: ${String(settings.denoiseKind)}`);
  }

  const windowAlpha = requireFiniteNumber(settings.windowAlpha, 'windowAlpha');
  if (windowAlpha < 0 || windowAlpha > 1) {
    fail('windowAlpha must be between 0 and 1');
  }
  const denoiseStrength = requireFiniteNumber(
    settings.denoiseStrength,
    'denoiseStrength'
  );
  if (denoiseStrength < 0) fail('denoiseStrength must be non-negative');
  const denoiseMaxAttenDb = requireFiniteNumber(
    settings.denoiseMaxAttenDb,
    'denoiseMaxAttenDb'
  );
  if (denoiseMaxAttenDb < 0 || denoiseMaxAttenDb > 60) {
    fail('denoiseMaxAttenDb must be between 0 and 60');
  }

  return Object.freeze({
    windowKind: settings.windowKind,
    windowAlpha,
    denoiseKind: settings.denoiseKind,
    denoiseStrength,
    denoiseMaxAttenDb,
  });
}

function normalizeNoiseProfile(input) {
  if (input == null) return null;
  if (typeof input !== 'object') fail('noiseProfile must be an object or null');

  const fftSize = requireInteger(input.fft_size, 'noiseProfile.fft_size', 4);
  if (!isPowerOfTwo(fftSize)) {
    fail('noiseProfile.fft_size must be a power of two');
  }
  if (fftSize > 32768) fail('noiseProfile.fft_size is too large');
  const hopSize = requireInteger(
    input.hop_size ?? fftSize / 4,
    'noiseProfile.hop_size'
  );
  if (hopSize !== fftSize / 4) {
    fail('noiseProfile.hop_size must equal one quarter of fft_size');
  }
  const sampleRate = requireFiniteNumber(
    input.sample_rate,
    'noiseProfile.sample_rate'
  );
  if (sampleRate <= 0) fail('noiseProfile.sample_rate must be positive');
  const channelCount = requireInteger(
    input.channels,
    'noiseProfile.channels'
  );
  const rawByChannel = input.noise_power_by_channel;
  if (!Array.isArray(rawByChannel) || rawByChannel.length !== channelCount) {
    fail('noiseProfile.noise_power_by_channel does not match channels');
  }

  const binCount = fftSize / 2 + 1;
  const noisePowerByChannel = rawByChannel.map((rawChannel, channelIndex) => {
    if (!Array.isArray(rawChannel) && !ArrayBuffer.isView(rawChannel)) {
      fail(`noise profile channel ${channelIndex} must be an array`);
    }
    if (rawChannel.length !== binCount) {
      fail(
        `noise profile channel ${channelIndex} must contain ${binCount} bins`
      );
    }
    const values = new Float64Array(binCount);
    for (let bin = 0; bin < binCount; bin++) {
      const value = Number(rawChannel[bin]);
      if (!Number.isFinite(value) || value < 0) {
        fail(`noise profile channel ${channelIndex} contains invalid power`);
      }
      values[bin] = value;
    }
    return values;
  });

  return Object.freeze({
    fftSize,
    hopSize,
    sampleRate,
    channelCount,
    noisePowerByChannel,
    linkedNoiseCache: new Map(),
  });
}

function initialize(message) {
  const settings = normalizeSettings(message.settings);
  const noiseProfile = normalizeNoiseProfile(message.noiseProfile);
  if (settings.denoiseKind === 'spectral' && !noiseProfile) {
    fail('spectral denoising requires a noise profile');
  }
  workerState = { settings, noiseProfile };
  self.postMessage({ type: 'ready' });
}

function fftInPlace(real, imaginary, inverse = false) {
  const size = real.length;
  for (let index = 1, reversed = 0; index < size; index++) {
    let bit = size >> 1;
    while (reversed & bit) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      const realValue = real[index];
      real[index] = real[reversed];
      real[reversed] = realValue;
      const imaginaryValue = imaginary[index];
      imaginary[index] = imaginary[reversed];
      imaginary[reversed] = imaginaryValue;
    }
  }

  for (let length = 2; length <= size; length *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    const halfLength = length / 2;
    for (let start = 0; start < size; start += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let offset = 0; offset < halfLength; offset++) {
        const even = start + offset;
        const odd = even + halfLength;
        const oddReal =
          real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary =
          real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        const evenReal = real[even];
        const evenImaginary = imaginary[even];
        real[even] = evenReal + oddReal;
        imaginary[even] = evenImaginary + oddImaginary;
        real[odd] = evenReal - oddReal;
        imaginary[odd] = evenImaginary - oddImaginary;

        const nextTwiddleReal =
          twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary =
          twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextTwiddleReal;
      }
    }
  }

  if (inverse) {
    for (let index = 0; index < size; index++) {
      real[index] /= size;
      imaginary[index] /= size;
    }
  }
}

function makeHannWindow(frameCount) {
  const values = new Float64Array(frameCount);
  const denominator = frameCount - 1;
  for (let index = 0; index < frameCount; index++) {
    values[index] = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / denominator);
  }
  return values;
}

function reflectIndex(index, length) {
  if (length <= 1) return 0;
  const period = 2 * (length - 1);
  let wrapped = index % period;
  if (wrapped < 0) wrapped += period;
  return wrapped < length ? wrapped : period - wrapped;
}

function makePaddedChannels(channels, fftSize, hopSize) {
  const frameCount = channels[0].length;
  const padding = fftSize / 2;
  const reflectedLength = frameCount + 2 * padding;
  const remainder = (reflectedLength - fftSize) % hopSize;
  const extra = (hopSize - remainder) % hopSize;
  const paddedLength = reflectedLength + extra;
  const paddedChannels = channels.map(channel => {
    const padded = new Float64Array(paddedLength);
    for (let index = 0; index < reflectedLength; index++) {
      const sourceIndex = reflectIndex(index - padding, frameCount);
      padded[index] = channel[sourceIndex];
    }
    return padded;
  });
  return { paddedChannels, paddedLength, padding };
}

function interpolateNoisePower(values, sourceBin) {
  if (sourceBin <= 0) return values[0];
  const lastIndex = values.length - 1;
  if (sourceBin >= lastIndex) return values[lastIndex];
  const left = Math.floor(sourceBin);
  const fraction = sourceBin - left;
  return values[left] * (1 - fraction) + values[left + 1] * fraction;
}

function getLinkedNoisePower(profile, sampleRate) {
  const cacheKey = String(sampleRate);
  const cached = profile.linkedNoiseCache.get(cacheKey);
  if (cached) return cached;

  const binCount = profile.fftSize / 2 + 1;
  const linked = new Float64Array(binCount);
  const sourceNyquistHz = profile.sampleRate / 2;
  const binPowerScale = sampleRate / profile.sampleRate;
  for (let bin = 0; bin < binCount; bin++) {
    const frequencyHz = bin * sampleRate / profile.fftSize;
    if (frequencyHz > sourceNyquistHz) {
      linked[bin] = 0;
      continue;
    }
    const sourceBin = frequencyHz * profile.fftSize / profile.sampleRate;
    let power = 0;
    for (const channel of profile.noisePowerByChannel) {
      power += interpolateNoisePower(channel, sourceBin);
    }
    linked[bin] = power * binPowerScale;
  }
  profile.linkedNoiseCache.set(cacheKey, linked);
  return linked;
}

function smoothGainAcrossFrequency(gain, frameCount, binCount) {
  let current = gain;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float64Array(current.length);
    for (let frame = 0; frame < frameCount; frame++) {
      const base = frame * binCount;
      for (let bin = 0; bin < binCount; bin++) {
        const left = current[base + Math.max(0, bin - 1)];
        const center = current[base + bin];
        const right = current[base + Math.min(binCount - 1, bin + 1)];
        next[base + bin] = 0.2 * left + 0.6 * center + 0.2 * right;
      }
    }
    current = next;
  }
  return current;
}

function smoothGainAcrossTime(gain, frameCount, binCount, sampleRate, hopSize) {
  const attack = Math.exp(-hopSize / sampleRate / 0.005);
  const release = Math.exp(-hopSize / sampleRate / 0.060);
  for (let frame = 1; frame < frameCount; frame++) {
    const base = frame * binCount;
    const previousBase = base - binCount;
    for (let bin = 0; bin < binCount; bin++) {
      const target = gain[base + bin];
      const previous = gain[previousBase + bin];
      const coefficient = target > previous ? attack : release;
      gain[base + bin] =
        coefficient * previous + (1 - coefficient) * target;
    }
  }
}

function spectralDenoise(channels, sampleRate, settings, profile) {
  const fftSize = profile?.fftSize || DEFAULT_FFT_SIZE;
  const hopSize = fftSize / 4;
  const binCount = fftSize / 2 + 1;
  const { paddedChannels, paddedLength, padding } = makePaddedChannels(
    channels,
    fftSize,
    hopSize
  );
  const analysisWindow = makeHannWindow(fftSize);
  const stftFrameCount = Math.floor((paddedLength - fftSize) / hopSize) + 1;
  const spectrumLength = stftFrameCount * binCount;
  const spectrumReal = channels.map(() => new Float64Array(spectrumLength));
  const spectrumImaginary = channels.map(
    () => new Float64Array(spectrumLength)
  );
  const linkedPower = new Float64Array(spectrumLength);
  const fftReal = new Float64Array(fftSize);
  const fftImaginary = new Float64Array(fftSize);

  for (let frame = 0; frame < stftFrameCount; frame++) {
    const start = frame * hopSize;
    const spectrumBase = frame * binCount;
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      const padded = paddedChannels[channelIndex];
      for (let index = 0; index < fftSize; index++) {
        fftReal[index] = padded[start + index] * analysisWindow[index];
        fftImaginary[index] = 0;
      }
      fftInPlace(fftReal, fftImaginary);
      const realOutput = spectrumReal[channelIndex];
      const imaginaryOutput = spectrumImaginary[channelIndex];
      for (let bin = 0; bin < binCount; bin++) {
        const outputIndex = spectrumBase + bin;
        const real = fftReal[bin];
        const imaginary = fftImaginary[bin];
        realOutput[outputIndex] = real;
        imaginaryOutput[outputIndex] = imaginary;
        linkedPower[outputIndex] += real * real + imaginary * imaginary;
      }
    }
  }

  const linkedNoise = getLinkedNoisePower(profile, sampleRate);
  const minimumGain = 10 ** (-settings.denoiseMaxAttenDb / 20);
  const minimumPowerGain = minimumGain * minimumGain;
  let gain = new Float64Array(spectrumLength);
  for (let frame = 0; frame < stftFrameCount; frame++) {
    const base = frame * binCount;
    for (let bin = 0; bin < binCount; bin++) {
      const cleanPowerRatio = 1 - settings.denoiseStrength *
        linkedNoise[bin] / Math.max(linkedPower[base + bin], EPSILON);
      const clipped = Math.min(1, Math.max(minimumPowerGain, cleanPowerRatio));
      gain[base + bin] = Math.sqrt(clipped);
    }
  }
  gain = smoothGainAcrossFrequency(gain, stftFrameCount, binCount);
  smoothGainAcrossTime(gain, stftFrameCount, binCount, sampleRate, hopSize);

  const reconstructed = channels.map(() => new Float64Array(paddedLength));
  const overlapWeight = new Float64Array(paddedLength);
  for (let frame = 0; frame < stftFrameCount; frame++) {
    const start = frame * hopSize;
    const spectrumBase = frame * binCount;
    for (let index = 0; index < fftSize; index++) {
      const windowValue = analysisWindow[index];
      overlapWeight[start + index] += windowValue * windowValue;
    }
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      const realInput = spectrumReal[channelIndex];
      const imaginaryInput = spectrumImaginary[channelIndex];
      fftReal.fill(0);
      fftImaginary.fill(0);
      for (let bin = 0; bin < binCount; bin++) {
        const inputIndex = spectrumBase + bin;
        const frameGain = gain[inputIndex];
        fftReal[bin] = realInput[inputIndex] * frameGain;
        fftImaginary[bin] = imaginaryInput[inputIndex] * frameGain;
      }
      for (let bin = 1; bin < fftSize / 2; bin++) {
        fftReal[fftSize - bin] = fftReal[bin];
        fftImaginary[fftSize - bin] = -fftImaginary[bin];
      }
      fftImaginary[0] = 0;
      fftImaginary[fftSize / 2] = 0;
      fftInPlace(fftReal, fftImaginary, true);

      const output = reconstructed[channelIndex];
      for (let index = 0; index < fftSize; index++) {
        output[start + index] += fftReal[index] * analysisWindow[index];
      }
    }
  }

  const frameCount = channels[0].length;
  return reconstructed.map(channel => {
    const clean = new Float32Array(frameCount);
    for (let frame = 0; frame < frameCount; frame++) {
      const paddedIndex = padding + frame;
      const value = channel[paddedIndex] /
        Math.max(overlapWeight[paddedIndex], EPSILON);
      clean[frame] = Number.isFinite(value) ? value : 0;
    }
    return clean;
  });
}

function makeGrainWindow(frameCount, kind, alpha) {
  if (kind === 'none') return null;
  const values = new Float64Array(frameCount);
  if (frameCount === 1) {
    values[0] = 1;
    return values;
  }
  const denominator = frameCount - 1;
  if (kind === 'hann' || (kind === 'tukey' && alpha >= 1)) {
    for (let index = 0; index < frameCount; index++) {
      values[index] =
        0.5 - 0.5 * Math.cos(2 * Math.PI * index / denominator);
    }
    return values;
  }
  if (kind !== 'tukey') fail(`unsupported grain window: ${kind}`);
  if (alpha <= 0) {
    values.fill(1);
    return values;
  }

  const halfTaper = alpha / 2;
  for (let index = 0; index < frameCount; index++) {
    const position = index / denominator;
    if (position < halfTaper) {
      values[index] = 0.5 * (
        1 + Math.cos(Math.PI * (2 * position / alpha - 1))
      );
    } else if (position <= 1 - halfTaper) {
      values[index] = 1;
    } else {
      values[index] = 0.5 * (
        1 + Math.cos(
          Math.PI * (2 * position / alpha - 2 / alpha + 1)
        )
      );
    }
  }
  return values;
}

function applyGrainWindow(channels, settings) {
  const window = makeGrainWindow(
    channels[0].length,
    settings.windowKind,
    settings.windowAlpha
  );
  if (!window) return;
  for (const channel of channels) {
    for (let frame = 0; frame < channel.length; frame++) {
      channel[frame] *= window[frame];
    }
  }
}

function measureRmsDbfs(channels) {
  let energy = 0;
  let sampleCount = 0;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index++) {
      const sample = channel[index];
      energy += sample * sample;
      sampleCount += 1;
    }
  }
  const rms = Math.sqrt(energy / sampleCount);
  return 20 * Math.log10(Math.max(rms, EPSILON));
}

function decodeChannels(rawChannels) {
  if (!Array.isArray(rawChannels) || rawChannels.length === 0) {
    fail('process.channels must contain at least one ArrayBuffer');
  }
  let frameCount = null;
  return rawChannels.map((buffer, channelIndex) => {
    if (!(buffer instanceof ArrayBuffer)) {
      fail(`process channel ${channelIndex} must be an ArrayBuffer`);
    }
    if (buffer.byteLength === 0 || buffer.byteLength % Float32Array.BYTES_PER_ELEMENT) {
      fail(`process channel ${channelIndex} has an invalid byte length`);
    }
    const input = new Float32Array(buffer);
    if (frameCount === null) frameCount = input.length;
    if (input.length !== frameCount) {
      fail('all process channels must have the same frame count');
    }
    for (let index = 0; index < input.length; index++) {
      if (!Number.isFinite(input[index])) {
        fail(`process channel ${channelIndex} contains a non-finite sample`);
      }
    }
    return input;
  });
}

function processGrain(message) {
  if (!workerState) fail('worker must be initialized before processing');
  const sampleRate = requireFiniteNumber(message.sampleRate, 'sampleRate');
  if (sampleRate <= 0) fail('sampleRate must be positive');
  let channels = decodeChannels(message.channels);
  const { settings, noiseProfile } = workerState;
  if (
    settings.denoiseKind === 'spectral' &&
    noiseProfile.channelCount !== channels.length
  ) {
    fail(
      `noise profile has ${noiseProfile.channelCount} channels, ` +
      `but grain has ${channels.length}`
    );
  }

  // Keep this order aligned with synthesize_texture.py: denoise first, apply
  // the grain-edge window second, then measure the level used for matching.
  if (settings.denoiseKind === 'spectral') {
    channels = spectralDenoise(channels, sampleRate, settings, noiseProfile);
  }
  applyGrainWindow(channels, settings);
  const rmsDbfs = measureRmsDbfs(channels);
  const buffers = channels.map(channel => channel.buffer);
  self.postMessage(
    { type: 'result', jobId: message.jobId, channels: buffers, rmsDbfs },
    buffers
  );
}

self.onmessage = event => {
  const message = event?.data;
  const jobId = message && Object.prototype.hasOwnProperty.call(message, 'jobId')
    ? message.jobId
    : null;
  try {
    if (!message || typeof message !== 'object') fail('message must be an object');
    if (message.type === 'init') {
      initialize(message);
      return;
    }
    if (message.type === 'process') {
      processGrain(message);
      return;
    }
    fail(`unsupported worker message type: ${String(message.type)}`);
  } catch (error) {
    self.postMessage({
      type: 'error',
      jobId,
      message: error?.message || String(error),
    });
  }
};
