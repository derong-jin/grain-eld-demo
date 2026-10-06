import * as THREE from 'three';
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

function updateLabelRendererClip() {
  const labelLayer = document.getElementById('labelRendererLayer');
  const panel = document.getElementById('controlPanel');
  if (!labelLayer || !panel) return;

  const leftInset = panel.classList.contains('panel-collapsed') ? 0 : 250;
  labelLayer.style.clipPath = `inset(0 0 0 ${leftInset}px)`;
  labelLayer.style.webkitClipPath = `inset(0 0 0 ${leftInset}px)`;
}

// Function to create CSS2D text label
function createTextLabel(text, color) {
  color = parseInt(color);
  console.log('Creating label for', text, 'with color', color);
  const div = document.createElement('div');
  div.textContent = text;
  div.style.color = `#${color.toString(16).padStart(6, '0')}`;
  div.style.fontSize = '18px';
  div.style.fontWeight = 'bold';
  div.style.fontFamily = 'Arial, sans-serif';
  div.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8), -1px -1px 2px rgba(255,255,255,0.5)';
  div.style.padding = '4px 8px';
  div.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
  div.style.borderRadius = '4px';
  div.style.pointerEvents = 'none';
  div.style.userSelect = 'none';

  const label = new CSS2DObject(div);
  return label;
}

// Audio
const plyLoader = new PLYLoader();
let audioCtx = null;
let srcNode = null;
let gainNode = null;
let stereoPanner = null;
let foa = null;
const staticSources = [];
let volumeAudio = true;
let sourceVisible = false;
let centroidVisible = false;
let isSingleSource = false;
let minimapLoadTimer = null;
let minimapLoadPromise = Promise.resolve();
let minimapRequestId = 0;
let isUiLocked = false;
const panContainer = document.getElementById('panContainer');
const panMeter     = document.getElementById('panMeter');
const panValue     = document.getElementById('panValue');
const gainMeter    = document.getElementById('gainMeter');
const gainValue    = document.getElementById('gainValue');
const c = 343.3;

// Real-time grain rendering. Grain assets are loaded lazily the first time the
// user switches away from the original loop, then scheduled on AudioContext
// time with a short look-ahead window.
const GRAIN_LOAD_CONCURRENCY = 6;
const GRAIN_SCHEDULER_INTERVAL_MS = 25;
const GRAIN_SCHEDULER_LOOKAHEAD_SEC = 0.1;
const GRAIN_SCHEDULER_START_LEAD_SEC = 0.03;
const GRAIN_MAX_EVENTS_PER_TICK = 64;
const GRAIN_MAX_RATE_HZ = 100;
const GRAIN_MODE_FADE_SEC = 0.02;
const GRAIN_EDGE_FADE_SEC = 0.005;
const GRAIN_ELD_REFRESH_MS = 100;
const GRAIN_MAX_ELD_DEVIATION_DB = 36;
const GRAIN_DEFAULT_WINDOW_KIND = 'tukey';
const GRAIN_DEFAULT_WINDOW_ALPHA = 0.25;
const GRAIN_DEFAULT_DENOISE_KIND = 'none';
const GRAIN_DEFAULT_DENOISE_STRENGTH = 1;
const GRAIN_DEFAULT_DENOISE_MAX_ATTEN_DB = 18;
const grainToggleButton = document.getElementById('toggleGrainRendering');
const grainRenderingStatus = document.getElementById('grainRenderingStatus');
const grainWindowKindSelect = document.getElementById('grainWindowKind');
const grainWindowOptions = document.getElementById('grainWindowOptions');
const grainWindowAlphaInput = document.getElementById('grainWindowAlpha');
const grainDenoiseKindSelect = document.getElementById('grainDenoiseKind');
const grainDenoiseOptions = document.getElementById('grainDenoiseOptions');
const grainDenoiseStrengthInput = document.getElementById('grainDenoiseStrength');
const grainDenoiseMaxAttenInput = document.getElementById('grainDenoiseMaxAtten');
let grainRenderingEnabled = false;
let grainRequestedContentMode = 'loop';
let grainSchedulerTimer = null;
let grainModeGeneration = 0;

// Optional direct-path ELD inspector. Gaussian, KDE, and histogram views use
// the same weighted point-cloud loudness samples. A manual Dummy Gaussian is
// also available as a representation when exactly one source is live and has
// grain assets. The selected representation drives both the plot and grain
// event levels. Reflections, diffraction, and occlusion remain outside this model.
const ELD_REFERENCE_DISTANCE = 1.0;
const ELD_MIN_DISTANCE = 1.0;
const ELD_DEFAULT_BIN_WIDTH_DB = 3.0;
const ELD_DEFAULT_KDE_BANDWIDTH_DB = 1.5;
const ELD_DEFAULT_GAUSSIAN_SIGMA_SCALE = 1.0;
const ELD_DEFAULT_GAUSSIAN_SIGMA_FLOOR_DB = 0.5;
const ELD_DEFAULT_DUMMY_MEAN_DB = -20;
const ELD_DEFAULT_DUMMY_SIGMA_DB = 4;
const ELD_MIN_DUMMY_SIGMA_DB = 0.1;
const ELD_MAX_DUMMY_SIGMA_DB = 20;
const ELD_POINT_CLOUD_METHODS = ['histogram', 'gaussian', 'kde'];
const ELD_METHODS = [...ELD_POINT_CLOUD_METHODS, 'dummy-gaussian'];
const ELD_DEFAULT_FIXED_X_SPAN_DB = 60;
const ELD_DEFAULT_FIXED_X_CENTER_DB = -30;
const ELD_MIN_ADAPTIVE_X_SPAN_DB = 6;
const ELD_TAIL_SIGMAS = 4;
const ELD_CURVE_SAMPLE_COUNT = 241;
const ELD_MAX_CURVE_SAMPLE_COUNT = 8193;
const ELD_MAX_SAMPLES_PER_SOURCE = 4096;
const ELD_UPDATE_INTERVAL_MS = 100;
const ELD_CAMERA_MOVE_EPSILON_SQ = 0.0025;
const eldWindow = document.getElementById('eldWindow');
const eldToggleButton = document.getElementById('toggleEldWindow');
const eldCloseButton = document.getElementById('closeEldWindow');
const eldSourceList = document.getElementById('eldSourceList');
const eldCanvas = document.getElementById('eldCanvas');
const eldStats = document.getElementById('eldStats');
const eldWindowSubtitle = document.getElementById('eldWindowSubtitle');
const eldResolvedRange = document.getElementById('eldResolvedRange');
const eldMethodSelect = document.getElementById('eldMethod');
const eldHistogramOptions = document.getElementById('eldHistogramOptions');
const eldHistogramBinWidthInput = document.getElementById('eldHistogramBinWidth');
const eldKdeOptions = document.getElementById('eldKdeOptions');
const eldKdeBandwidthInput = document.getElementById('eldKdeBandwidth');
const eldGaussianOptions = document.getElementById('eldGaussianOptions');
const eldGaussianSigmaScaleInput = document.getElementById('eldGaussianSigmaScale');
const eldGaussianSigmaFloorInput = document.getElementById('eldGaussianSigmaFloor');
const eldDummyMethodOption = document.getElementById('eldDummyMethodOption');
const eldDummyOptions = document.getElementById('eldDummyOptions');
const eldDummyMeanInput = document.getElementById('eldDummyMean');
const eldDummySigmaInput = document.getElementById('eldDummySigma');
const eldXLengthModeSelect = document.getElementById('eldXLengthMode');
const eldXSpanInput = document.getElementById('eldXSpanDb');
const eldXPositionModeSelect = document.getElementById('eldXPositionMode');
const eldXCenterInput = document.getElementById('eldXCenterDb');
const selectedEldSourceIds = new Set();
const eldLastCameraPosition = new THREE.Vector3(
  Number.POSITIVE_INFINITY,
  Number.POSITIVE_INFINITY,
  Number.POSITIVE_INFINITY
);
let eldDirty = true;
let eldLastUpdateMs = -Infinity;
let lastPointCloudEldMethod = 'histogram';

// HRIR-based binaural rendering
let hrirBuffers = null; // Will store {W, X, Y, Z} buffers
let useHRIR = false; // Toggle between HRIR and stereo panning

// Load HRIR files for FOA binaural decoding
async function loadHRIRs(ctx) {
  const hrirDir = 'HRIRs_FOA/';
  const channels = ['W', 'X', 'Y', 'Z'];
  const buffers = {};

  try {
    for (const ch of channels) {
      const url = hrirDir + `FOA_${ch}.wav`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load ${url}: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      buffers[ch] = await ctx.decodeAudioData(arrayBuffer);
      console.log(`Loaded HRIR for channel ${ch}: ${buffers[ch].length} samples, ${buffers[ch].numberOfChannels} channels`);
    }
    console.log('All HRIRs loaded successfully');
    return buffers;
  } catch (err) {
    console.error('Failed to load HRIRs:', err);
    return null;
  }
}

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0x808080, 0x202020));
const dl = new THREE.DirectionalLight(0xffffff, 0.5);
dl.position.set(5, 10, 7);
scene.add(dl);

// ==== NEW: 性能 UI 元素引用 ====
const cbLastEl       = document.getElementById('cbLast');
const cbAvgEl        = document.getElementById('cbAvg');
const sampleRateEl   = document.getElementById('sampleRate');
const bufferSamplesEl= document.getElementById('bufferSamples');
const bufferMsEl     = document.getElementById('bufferMs');
let cbAvgMs = 0;
const cbSmooth = 0.1; // callback 耗时平均的平滑系数

function updateAudioMetrics() {
  if (!audioCtx) {
    if (sampleRateEl) sampleRateEl.textContent = '-';
    if (bufferSamplesEl) bufferSamplesEl.textContent = '-';
    if (bufferMsEl) bufferMsEl.textContent = '-';
    return;
  }
  const sr = audioCtx.sampleRate || 0;
  if (sampleRateEl) sampleRateEl.textContent = sr ? sr.toFixed(0) : '-';

  const baseLat = audioCtx.baseLatency || 0;
  const outLat  = audioCtx.outputLatency || 0;
  const effectiveLat = baseLat || outLat; // 有些浏览器只给其中一个

  if (effectiveLat && sr) {
    const frames = Math.round(effectiveLat * sr);
    const ms = effectiveLat * 1000;
    if (bufferSamplesEl) bufferSamplesEl.textContent = frames.toString();
    if (bufferMsEl) bufferMsEl.textContent = ms.toFixed(2);
  } else {
    if (bufferSamplesEl) bufferSamplesEl.textContent = 'unknown';
    if (bufferMsEl) bufferMsEl.textContent = 'unknown';
  }
}

async function loadMinimapScene(selectedScene, requestId) {
  try {
    if (minimapSceneLoaded) {
      await minimapViewer.removeSplatScene(0);
      minimapSceneLoaded = false;
    }

    if (requestId !== minimapRequestId) return;

    // In 0.4.7, await the native promise: AbortablePromise.then ignores rejection callbacks.
    await minimapViewer.addSplatScene(
      selectedScene,
      {
        splatAlphaRemovalThreshold: 5,
        showLoadingUI: false,
        position: [0, 0, 0],
        rotation: [1, 0, 0, 0],
        scale: [1.0, 1.0, 1.0],
        progressiveLoad: false,
      },
    ).promise;

    if (requestId !== minimapRequestId) {
      try {
        await minimapViewer.removeSplatScene(0);
      } catch (e) {}
      return;
    }

    minimapSceneLoaded = true;
    setMinimapLoading(false);
    console.log('Minimap scene loaded:', selectedScene);
  } catch (err) {
    if (requestId === minimapRequestId) {
      setMinimapLoading(false);
    }
    console.error('Failed to load minimap scene:', err);
  }
}

async function clearMinimapScene() {
  if (minimapLoadTimer) {
    clearTimeout(minimapLoadTimer);
    minimapLoadTimer = null;
  }

  minimapRequestId += 1; // 让所有旧请求失效
  await minimapLoadPromise;

  if (minimapViewer.getSceneCount() > 0) {
    try {
      await minimapViewer.removeSplatScene(0);
    } catch (err) {
      console.warn('Failed to clear minimap scene:', err);
    }
    minimapSceneLoaded = false;
  }
  minimapViewer.renderer.clear();
}

function scheduleMinimapLoad(selectedScene, delay = 800) {
  minimapRequestId += 1;
  const requestId = minimapRequestId;

  if (minimapLoadTimer) {
    clearTimeout(minimapLoadTimer);
  }

  minimapLoadTimer = setTimeout(() => {
    minimapLoadPromise = loadMinimapScene(selectedScene, requestId);
    minimapLoadTimer = null;
  }, delay);
}

function setMinimapLoading(isLoading) {
  const overlay = document.getElementById('minimapLoadingOverlay');
  if (!overlay) return;
  overlay.classList.toggle('active', isLoading);
}

function setMainLoading(isLoading) {
  const overlay = document.getElementById('mainLoadingOverlay');
  if (!overlay) return;
  overlay.classList.toggle('active', isLoading);
  setUiLocked(isLoading);
}

function resetVisualizationState() {
  centroidVisible = false;
  sourceVisible = false;

  staticSources.forEach(s => {
    if (s.centroid) s.centroid.visible = false;
    if (s.points) s.points.visible = false;
    if (s.label) s.label.visible = false;
  });
}

function getGrainCapableSources() {
  return staticSources.filter(source => !source.disposed && source.grainPath);
}

function formatGrainRate(rateHz) {
  if (!Number.isFinite(rateHz)) return '–';
  return Number.isInteger(rateHz) ? rateHz.toFixed(0) : rateHz.toFixed(2);
}

function readGrainProcessingNumber(input, fallback, minimum, maximum) {
  const parsed = Number.parseFloat(input?.value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function getGrainProcessingSettings() {
  const selectedWindow = grainWindowKindSelect?.value;
  const windowKind = ['none', 'tukey', 'hann'].includes(selectedWindow)
    ? selectedWindow
    : GRAIN_DEFAULT_WINDOW_KIND;
  const selectedDenoise = grainDenoiseKindSelect?.value;
  const denoiseKind = ['none', 'spectral'].includes(selectedDenoise)
    ? selectedDenoise
    : GRAIN_DEFAULT_DENOISE_KIND;
  const settings = {
    windowKind,
    windowAlpha: readGrainProcessingNumber(
      grainWindowAlphaInput,
      GRAIN_DEFAULT_WINDOW_ALPHA,
      0,
      1
    ),
    denoiseKind,
    denoiseStrength: readGrainProcessingNumber(
      grainDenoiseStrengthInput,
      GRAIN_DEFAULT_DENOISE_STRENGTH,
      0,
      100
    ),
    denoiseMaxAttenDb: readGrainProcessingNumber(
      grainDenoiseMaxAttenInput,
      GRAIN_DEFAULT_DENOISE_MAX_ATTEN_DB,
      0,
      60
    ),
  };
  settings.key = [
    settings.windowKind,
    settings.windowAlpha.toFixed(6),
    settings.denoiseKind,
    settings.denoiseStrength.toFixed(6),
    settings.denoiseMaxAttenDb.toFixed(6),
  ].join('|');
  return Object.freeze(settings);
}

function formatGrainProcessingSettings(settings) {
  const windowText = settings.windowKind === 'tukey'
    ? `Tukey α ${settings.windowAlpha.toFixed(2)}`
    : (settings.windowKind === 'hann' ? 'Hann' : 'No window');
  const denoiseText = settings.denoiseKind === 'spectral'
    ? `Spectral ×${settings.denoiseStrength.toFixed(1)}` +
      ` / ${settings.denoiseMaxAttenDb.toFixed(0)} dB`
    : 'No denoise';
  return `${windowText} · ${denoiseText}`;
}

function syncGrainPreprocessingUi() {
  const sources = getGrainCapableSources();
  const isLoading = sources.some(source => source.grainState === 'loading');
  const settings = getGrainProcessingSettings();
  const controlsDisabled = isUiLocked || !sources.length || isLoading;

  if (grainWindowKindSelect) grainWindowKindSelect.disabled = controlsDisabled;
  if (grainDenoiseKindSelect) grainDenoiseKindSelect.disabled = controlsDisabled;
  if (grainWindowOptions) {
    grainWindowOptions.hidden = settings.windowKind !== 'tukey';
  }
  if (grainDenoiseOptions) {
    grainDenoiseOptions.hidden = settings.denoiseKind !== 'spectral';
  }
  if (grainWindowAlphaInput) {
    grainWindowAlphaInput.disabled =
      controlsDisabled || settings.windowKind !== 'tukey';
  }
  [grainDenoiseStrengthInput, grainDenoiseMaxAttenInput].forEach(input => {
    if (input) {
      input.disabled = controlsDisabled || settings.denoiseKind !== 'spectral';
    }
  });
}

function setGrainRenderingStatus(message, state = '') {
  if (!grainRenderingStatus) return;
  grainRenderingStatus.textContent = message;
  if (state) grainRenderingStatus.dataset.state = state;
  else delete grainRenderingStatus.dataset.state;
}

function updateGrainRenderingUi() {
  if (!grainToggleButton) return;
  const sources = getGrainCapableSources();
  const loadingSources = sources.filter(source => source.grainState === 'loading');
  const readySources = sources.filter(source => source.grainState === 'ready');
  const failedSources = sources.filter(source => source.grainState === 'error');
  syncGrainPreprocessingUi();

  if (grainRenderingStatus) {
    grainRenderingStatus.setAttribute(
      'aria-busy',
      String(Boolean(loadingSources.length))
    );
  }

  const isPreprocessing = loadingSources.some(
    source => source.grainProcessingStage === 'preprocessing'
  );
  grainToggleButton.textContent = loadingSources.length
    ? (isPreprocessing ? 'Processing Grains…' : 'Loading Grains…')
    : (
      failedSources.length
        ? 'Retry Grain Load'
        : (grainRenderingEnabled ? 'Grain Rendering' : 'Loop Audio')
    );
  grainToggleButton.disabled = isUiLocked || !sources.length || Boolean(loadingSources.length);
  grainToggleButton.setAttribute('aria-pressed', String(grainRenderingEnabled));

  if (!sources.length) {
    setGrainRenderingStatus(
      staticSources.some(source => !source.disposed)
        ? 'Grain rendering unavailable for this scene. Loop audio only.'
        : 'Load a scene to inspect grain assets.'
    );
    return;
  }

  if (loadingSources.length) {
    const completed = loadingSources.reduce(
      (total, source) => total + (
        source.grainProcessingStage === 'preprocessing'
          ? (source.grainProcessedCount || 0)
          : (source.grainLoadedCount || 0)
      ),
      0
    );
    const expected = loadingSources.reduce(
      (total, source) => total + (source.grainExpectedCount || 0),
      0
    );
    const progress = expected ? ` ${completed}/${expected}` : '';
    const stageLabel = isPreprocessing
      ? 'Preprocessing grain assets'
      : 'Decoding grain assets';
    setGrainRenderingStatus(`Muted · ${stageLabel}…${progress}`, 'loading');
    return;
  }

  if (failedSources.length) {
    const detail = failedSources[0].grainError || 'grain assets could not be loaded';
    setGrainRenderingStatus(`Muted · Grain load failed: ${detail}`, 'error');
    return;
  }

  if (!readySources.length) {
    const paths = sources.map(source => source.grainPath).join(', ');
    setGrainRenderingStatus(`Available: ${paths} · loads on first use.`);
    return;
  }

  const grainCount = readySources.reduce(
    (total, source) => total + source.grainBuffers.length,
    0
  );
  const rateText = readySources.length === 1
    ? `${formatGrainRate(readySources[0].grainRateHz)} events/s`
    : `${readySources.length} source rates`;
  const expectedOverlap = readySources.length === 1 &&
    Number.isFinite(readySources[0].grainMeanDurationSec)
    ? readySources[0].grainRateHz * readySources[0].grainMeanDurationSec
    : null;
  const overlapText = Number.isFinite(expectedOverlap)
    ? ` · ~${expectedOverlap.toFixed(1)} overlap`
    : '';
  const audioEldText = grainRenderingEnabled
    ? ` · ${getEldMethodDisplayName(getEldSettings().method)} ELD`
    : '';
  const failureCount = readySources.reduce(
    (total, source) => total + (source.grainLoadFailures || 0),
    0
  );
  const skipped = failureCount ? ` · ${failureCount} skipped` : '';
  const appliedSettings = readySources[0].grainProcessingSettings ||
    getGrainProcessingSettings();
  const processingText = ` · ${formatGrainProcessingSettings(appliedSettings)}`;
  setGrainRenderingStatus(
    `${grainCount} grains · ${rateText}${overlapText}${audioEldText}` +
      `${processingText}${skipped}`,
    grainRenderingEnabled ? 'active' : ''
  );
}

function disconnectAudioNode(node) {
  if (!node) return;
  try { node.disconnect(); } catch (error) {}
}

function stopActiveGrains(source) {
  if (!source.activeGrains) return;
  source.activeGrains.forEach(record => {
    record.sourceNode.onended = null;
    try { record.sourceNode.stop(); } catch (error) {}
    disconnectAudioNode(record.sourceNode);
    disconnectAudioNode(record.envelopeNode);
  });
  source.activeGrains.clear();
}

function stopGrainScheduler() {
  if (grainSchedulerTimer !== null) {
    clearInterval(grainSchedulerTimer);
    grainSchedulerTimer = null;
  }
}

function smoothAudioParam(audioParam, value, now, durationSec) {
  if (!audioParam) return;
  let heldCurrentValue = false;
  if (typeof audioParam.cancelAndHoldAtTime === 'function') {
    try {
      audioParam.cancelAndHoldAtTime(now);
      heldCurrentValue = true;
    } catch (error) {}
  }
  if (!heldCurrentValue) {
    const currentValue = audioParam.value;
    audioParam.cancelScheduledValues(now);
    audioParam.setValueAtTime(currentValue, now);
  }
  if (durationSec > 0) {
    audioParam.linearRampToValueAtTime(value, now + durationSec);
  } else {
    audioParam.setValueAtTime(value, now);
  }
}

function setSourceContentBusGains(source, useGrains, immediate = false) {
  if (!audioCtx || source.disposed) return;
  const now = audioCtx.currentTime;
  const duration = immediate ? 0 : GRAIN_MODE_FADE_SEC;
  smoothAudioParam(source.loopBus?.gain, useGrains ? 0 : 1, now, duration);
  smoothAudioParam(source.grainBus?.gain, useGrains ? 1 : 0, now, duration);
}

function silenceSourceContentBuses(source) {
  if (!audioCtx || source.disposed) return;
  const now = audioCtx.currentTime;
  smoothAudioParam(source.loopBus?.gain, 0, now, 0);
  smoothAudioParam(source.grainBus?.gain, 0, now, 0);
}

function clearSourceGrainCache(source) {
  source.grainLoadRevision = (source.grainLoadRevision || 0) + 1;
  source.grainLoadAbortController?.abort();
  source.grainLoadAbortController = null;
  source.grainLoadPromise = null;
  source.grainLoadingKey = null;
  source.grainProcessingKey = null;
  source.grainProcessingSettings = null;
  source.grainBuffers = [];
  source.grainState = source.grainPath ? 'idle' : 'unavailable';
  source.grainLoadedCount = 0;
  source.grainProcessedCount = 0;
  source.grainExpectedCount = 0;
  source.grainLoadFailures = 0;
  source.grainError = '';
  source.grainRateHz = null;
  source.grainRateWasClamped = false;
  source.grainMeanDurationSec = null;
  source.grainReferenceRmsDbfs = null;
  source.grainOverlapGain = 1;
  source.grainProcessingStage = '';
  source.nextGrainTime = null;
}

function disposeStaticSourceAudio(source) {
  if (!source || source.disposed) return;
  source.disposed = true;
  source.grainLoadRevision = (source.grainLoadRevision || 0) + 1;
  source.grainLoadAbortController?.abort();
  source.grainLoadAbortController = null;
  source.grainLoadPromise = null;
  source.grainLoadingKey = null;
  stopActiveGrains(source);

  if (source.srcNode) {
    try { source.srcNode.stop(); } catch (error) {}
  }
  [
    source.srcNode,
    source.loopBus,
    source.grainBus,
    source.gain,
    source.stereoPan,
    source.binauralMerger,
    ...(source.hrirAuxNodes || []),
    ...Object.values(source.foaGains || {}),
    ...Object.values(source.hrirConvolvers || {}),
  ].forEach(disconnectAudioNode);

  source.grainBuffers = [];
  source.grainEldProfile = null;
  source.nextGrainTime = null;
}

function disposeStaticSource(source, removeVisuals = false) {
  disposeStaticSourceAudio(source);
  if (!removeVisuals) return;
  [source.centroid, source.points].forEach(object => {
    if (!object) return;
    scene.remove(object);
    object.geometry?.dispose();
    object.material?.dispose();
  });
  if (source.label) scene.remove(source.label);
}

function deactivateGrainRendering({ immediate = false } = {}) {
  const generation = ++grainModeGeneration;
  grainRequestedContentMode = 'loop';
  grainRenderingEnabled = false;
  stopGrainScheduler();

  staticSources.forEach(source => {
    source.nextGrainTime = null;
    setSourceContentBusGains(source, false, immediate);
  });

  if (immediate) {
    staticSources.forEach(stopActiveGrains);
  } else {
    window.setTimeout(() => {
      if (generation !== grainModeGeneration || grainRenderingEnabled) return;
      staticSources.forEach(stopActiveGrains);
    }, Math.ceil((GRAIN_MODE_FADE_SEC + 0.015) * 1000));
  }
  updateGrainRenderingUi();
}

function stopCurrentSceneAudio() {
  grainRequestedContentMode = 'loop';
  grainRenderingEnabled = false;
  grainModeGeneration += 1;
  stopGrainScheduler();
  staticSources.forEach(source => disposeStaticSourceAudio(source));
  updateGrainRenderingUi();
}

function readEldNumber(input, fallback, minimum, maximum) {
  const parsed = Number.parseFloat(input?.value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function getDummyEldAvailability() {
  const liveSources = staticSources.filter(source => !source.disposed);
  const available = liveSources.length === 1 && Boolean(liveSources[0].grainPath);
  return {
    available,
    source: available ? liveSources[0] : null,
  };
}

function getEldSettings() {
  const selectedMethod = eldMethodSelect?.value;
  let method = ELD_METHODS.includes(selectedMethod)
    ? selectedMethod
    : 'histogram';
  if (method === 'dummy-gaussian' && !getDummyEldAvailability().available) {
    method = lastPointCloudEldMethod;
  }
  return {
    method,
    histogramBinWidthDb: readEldNumber(
      eldHistogramBinWidthInput,
      ELD_DEFAULT_BIN_WIDTH_DB,
      0.1,
      24
    ),
    kdeBandwidthDb: readEldNumber(
      eldKdeBandwidthInput,
      ELD_DEFAULT_KDE_BANDWIDTH_DB,
      0.1,
      24
    ),
    gaussianSigmaScale: readEldNumber(
      eldGaussianSigmaScaleInput,
      ELD_DEFAULT_GAUSSIAN_SIGMA_SCALE,
      0.1,
      10
    ),
    gaussianSigmaFloorDb: readEldNumber(
      eldGaussianSigmaFloorInput,
      ELD_DEFAULT_GAUSSIAN_SIGMA_FLOOR_DB,
      0.1,
      24
    ),
    dummyMeanDb: readEldNumber(
      eldDummyMeanInput,
      ELD_DEFAULT_DUMMY_MEAN_DB,
      -120,
      24
    ),
    dummySigmaDb: readEldNumber(
      eldDummySigmaInput,
      ELD_DEFAULT_DUMMY_SIGMA_DB,
      ELD_MIN_DUMMY_SIGMA_DB,
      ELD_MAX_DUMMY_SIGMA_DB
    ),
    xLengthMode: eldXLengthModeSelect?.value === 'fixed'
      ? 'fixed'
      : 'adaptive',
    xPositionMode: eldXPositionModeSelect?.value === 'fixed'
      ? 'fixed'
      : 'adaptive',
    fixedXSpanDb: readEldNumber(
      eldXSpanInput,
      ELD_DEFAULT_FIXED_X_SPAN_DB,
      1,
      240
    ),
    fixedXCenterDb: readEldNumber(
      eldXCenterInput,
      ELD_DEFAULT_FIXED_X_CENTER_DB,
      -300,
      100
    ),
  };
}

function getEldMethodDisplayName(method) {
  return {
    gaussian: 'Gaussian',
    kde: 'KDE',
    histogram: 'Histogram',
    'dummy-gaussian': 'Dummy Gaussian',
  }[method] || 'Histogram';
}

function setEldMethodOptionVisible(container, isVisible) {
  if (!container) return;
  container.hidden = !isVisible;
  container.querySelectorAll('input, select').forEach(control => {
    control.disabled = isUiLocked || !isVisible;
  });
}

function syncEldControlState() {
  const dummyAvailability = getDummyEldAvailability();
  if (ELD_POINT_CLOUD_METHODS.includes(eldMethodSelect?.value)) {
    lastPointCloudEldMethod = eldMethodSelect.value;
  }
  if (eldDummyMethodOption) {
    eldDummyMethodOption.disabled = !dummyAvailability.available;
  }
  if (
    !dummyAvailability.available &&
    eldMethodSelect?.value === 'dummy-gaussian'
  ) {
    eldMethodSelect.value = lastPointCloudEldMethod;
  }
  const settings = getEldSettings();
  setEldMethodOptionVisible(
    eldHistogramOptions,
    settings.method === 'histogram'
  );
  setEldMethodOptionVisible(eldKdeOptions, settings.method === 'kde');
  setEldMethodOptionVisible(
    eldGaussianOptions,
    settings.method === 'gaussian'
  );
  setEldMethodOptionVisible(
    eldDummyOptions,
    settings.method === 'dummy-gaussian'
  );
  if (eldMethodSelect) eldMethodSelect.disabled = isUiLocked;
  if (eldXLengthModeSelect) eldXLengthModeSelect.disabled = isUiLocked;
  if (eldXPositionModeSelect) eldXPositionModeSelect.disabled = isUiLocked;
  if (eldXSpanInput) {
    eldXSpanInput.disabled = isUiLocked || settings.xLengthMode !== 'fixed';
  }
  if (eldXCenterInput) {
    eldXCenterInput.disabled = isUiLocked || settings.xPositionMode !== 'fixed';
  }
  if (eldWindowSubtitle) {
    eldWindowSubtitle.textContent =
      `Direct path · ${getEldMethodDisplayName(settings.method)} representation`;
  }
}

function setUiLocked(isLocked) {
  isUiLocked = isLocked;

  const controlPanel = document.getElementById('controlPanel');
  const panelToggleBtn = document.getElementById('panelToggleBtn');
  const loadBtn = document.getElementById('loadGaussianScene');

  if (controlPanel) {
    controlPanel.classList.toggle('ui-locked', isLocked);
  }

  if (panelToggleBtn) {
    panelToggleBtn.classList.toggle('ui-locked', isLocked);
  }

  if (loadBtn) {
    loadBtn.disabled = isLocked;
  }

  document.querySelectorAll(
    '#controlPanel button, #controlPanel input, #controlPanel select'
  ).forEach(el => {
    el.disabled = isLocked;
  });

  if (eldWindow) {
    eldWindow.classList.toggle('ui-locked', isLocked);
  }
  document.querySelectorAll(
    '#eldWindow button, #eldWindow input, #eldWindow select'
  ).forEach(el => {
    el.disabled = isLocked;
  });
  syncEldControlState();
  if (eldToggleButton) {
    eldToggleButton.disabled = isLocked || staticSources.length === 0;
  }
  updateGrainRenderingUi();
}

function sourceColorForIndex(index) {
  const color = new THREE.Color();
  color.setHSL(((index * 0.381966 + 0.53) % 1), 0.72, 0.64);
  return color.getHex();
}

function loadPlyGeometry(url) {
  return new Promise((resolve, reject) => {
    const loader = new PLYLoader();
    loader.load(
      url,
      geometry => resolve(geometry),
      () => {},
      err => reject(new Error(`Load ELD PLY failed: ${err.message}`))
    );
  });
}

async function loadNpyFloat32(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Load ELD weights failed: HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const magic = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59];
  if (bytes.length < 12 || magic.some((value, index) => bytes[index] !== value)) {
    throw new Error('ELD weights are not a NumPy NPY file');
  }

  const major = bytes[6];
  let headerLength;
  let headerOffset;
  if (major === 1) {
    headerLength = bytes[8] | (bytes[9] << 8);
    headerOffset = 10;
  } else if (major === 2 || major === 3) {
    headerLength = new DataView(buffer).getUint32(8, true);
    headerOffset = 12;
  } else {
    throw new Error(`Unsupported NPY version ${major}`);
  }

  const dataOffset = headerOffset + headerLength;
  const header = new TextDecoder('latin1').decode(
    bytes.subarray(headerOffset, dataOffset)
  );
  const descriptor = header.match(/['"]descr['"]\s*:\s*['"]([^'"]+)['"]/);
  if (!descriptor || !['<f4', '|f4', '=f4'].includes(descriptor[1])) {
    throw new Error('ELD weights must be little-endian float32');
  }
  if (!/['"]fortran_order['"]\s*:\s*False/.test(header)) {
    throw new Error('Fortran-order ELD weights are unsupported');
  }
  const shape = header.match(/['"]shape['"]\s*:\s*\(([^)]*)\)/);
  if (!shape) {
    throw new Error('ELD weights NPY has no shape');
  }
  const dimensions = shape[1]
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(Number);
  if (dimensions.length !== 1 || !Number.isInteger(dimensions[0])) {
    throw new Error('ELD weights must be a one-dimensional array');
  }
  const count = dimensions[0];
  if (dataOffset + count * 4 > buffer.byteLength) {
    throw new Error('ELD weights NPY payload is truncated');
  }

  const view = new DataView(buffer, dataOffset, count * 4);
  const values = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    values[index] = view.getFloat32(index * 4, true);
  }
  return values;
}

function buildWeightedEldSamples(positionAttribute, rawWeights) {
  const pointCount = positionAttribute.count;
  if (!pointCount || rawWeights.length !== pointCount) {
    throw new Error(
      `ELD point/weight count mismatch (${pointCount} vs ${rawWeights.length})`
    );
  }

  let weightTotal = 0;
  for (const weight of rawWeights) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error('ELD point weights must be finite and non-negative');
    }
    weightTotal += weight;
  }
  if (!(weightTotal > 0)) {
    throw new Error('ELD point weights sum to zero');
  }

  if (pointCount <= ELD_MAX_SAMPLES_PER_SOURCE) {
    const positions = new Float32Array(pointCount * 3);
    const weights = new Float32Array(pointCount);
    for (let index = 0; index < pointCount; index++) {
      positions[index * 3] = positionAttribute.getX(index);
      positions[index * 3 + 1] = positionAttribute.getY(index);
      positions[index * 3 + 2] = positionAttribute.getZ(index);
      weights[index] = rawWeights[index] / weightTotal;
    }
    return { positions, weights, originalCount: pointCount };
  }

  // Deterministic systematic resampling preserves the normalized spatial mass
  // while keeping camera-driven updates inexpensive.
  const sampleCount = ELD_MAX_SAMPLES_PER_SOURCE;
  const positions = new Float32Array(sampleCount * 3);
  let sourceIndex = 0;
  let cumulative = rawWeights[0];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const target = ((sampleIndex + 0.5) / sampleCount) * weightTotal;
    while (sourceIndex < pointCount - 1 && cumulative < target) {
      sourceIndex += 1;
      cumulative += rawWeights[sourceIndex];
    }
    positions[sampleIndex * 3] = positionAttribute.getX(sourceIndex);
    positions[sampleIndex * 3 + 1] = positionAttribute.getY(sourceIndex);
    positions[sampleIndex * 3 + 2] = positionAttribute.getZ(sourceIndex);
  }
  return { positions, weights: null, originalCount: pointCount };
}

function setEldSourceStatus(source, status) {
  if (!source.eldOptionNameElement) return;
  const suffix = status ? ` · ${status}` : '';
  source.eldOptionNameElement.textContent = source.displayName + suffix;
}

async function ensureEldPointSamples(source) {
  if (source.eldSamples) return source.eldSamples;
  if (source.eldLoadPromise) return source.eldLoadPromise;

  source.eldLoadPromise = (async () => {
    setEldSourceStatus(source, 'loading…');
    let geometry;
    try {
      geometry = await loadPlyGeometry(source.fullPcdUrl);
      const loadedWeights = source.weightsUrl
        ? await loadNpyFloat32(source.weightsUrl)
        : null;
      const positionAttribute = geometry.getAttribute('position');
      if (!positionAttribute) {
        throw new Error('ELD source PLY has no position attribute');
      }
      const weights = loadedWeights || new Float32Array(
        positionAttribute.count
      ).fill(1);
      source.eldSamples = buildWeightedEldSamples(
        positionAttribute,
        weights
      );
      setEldSourceStatus(
        source,
        `${source.eldSamples.originalCount.toLocaleString()} pts`
      );
      return source.eldSamples;
    } catch (error) {
      setEldSourceStatus(source, 'load failed');
      throw error;
    } finally {
      if (geometry) geometry.dispose();
      source.eldLoadPromise = null;
    }
  })();
  return source.eldLoadPromise;
}

function prepareEldCanvas() {
  if (!eldCanvas || eldWindow.hidden) return null;
  const rect = eldCanvas.getBoundingClientRect();
  const width = Math.max(280, Math.round(rect.width));
  const height = Math.max(180, Math.round(rect.height));
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(width * pixelRatio);
  const pixelHeight = Math.round(height * pixelRatio);
  if (eldCanvas.width !== pixelWidth || eldCanvas.height !== pixelHeight) {
    eldCanvas.width = pixelWidth;
    eldCanvas.height = pixelHeight;
  }
  const context = eldCanvas.getContext('2d');
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

function drawEldPlaceholder(message) {
  eldCanvas?.setAttribute('aria-label', `Event loudness density. ${message}`);
  const canvas = prepareEldCanvas();
  if (!canvas) return;
  const { context, width, height } = canvas;
  context.fillStyle = 'rgba(255, 255, 255, 0.025)';
  context.fillRect(0, 0, width, height);
  context.fillStyle = 'rgba(255, 255, 255, 0.42)';
  context.font = '11px Inter, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(message, width / 2, height / 2);
}

function computeSourceLoudnessProfile(source, listenerPosition) {
  const samples = source.eldSamples;
  if (!samples || samples.positions.length === 0) return null;

  source.points.updateMatrixWorld(true);
  const matrix = source.points.matrixWorld;
  const point = new THREE.Vector3();
  const sampleCount = samples.positions.length / 3;
  const loudnesses = new Float32Array(sampleCount);
  loudnesses.fill(Number.NaN);
  let mean = 0;
  let moment2 = 0;
  let weightTotal = 0;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < sampleCount; index++) {
    const weight = samples.weights ? samples.weights[index] : 1 / sampleCount;
    if (!(weight > 0) || !Number.isFinite(weight)) continue;
    point.fromArray(samples.positions, index * 3).applyMatrix4(matrix);
    const distance = Math.max(
      point.distanceTo(listenerPosition),
      ELD_MIN_DISTANCE
    );
    const loudness = -20 * Math.log10(
      distance / ELD_REFERENCE_DISTANCE
    );
    if (!Number.isFinite(loudness)) continue;
    loudnesses[index] = loudness;
    minimum = Math.min(minimum, loudness);
    maximum = Math.max(maximum, loudness);

    const nextWeightTotal = weightTotal + weight;
    const delta = loudness - mean;
    mean += (weight / nextWeightTotal) * delta;
    moment2 += weight * delta * (loudness - mean);
    weightTotal = nextWeightTotal;
  }
  if (!(weightTotal > 0) || !Number.isFinite(minimum)) return null;
  const variance = Math.max(0, moment2 / weightTotal);
  return {
    source,
    loudnesses,
    weights: samples.weights,
    sampleCount,
    weightTotal,
    minimum,
    maximum,
    mean,
    variance,
    sigma: Math.sqrt(variance),
  };
}

function getEldProfileWeight(profile, index) {
  return profile.weights ? profile.weights[index] : 1 / profile.sampleCount;
}

function getEffectiveGaussianSigma(profile, settings) {
  return Math.max(
    profile.sigma * settings.gaussianSigmaScale,
    settings.gaussianSigmaFloorDb
  );
}

function isSafeRelativeAssetPath(value) {
  if (typeof value !== 'string') return false;
  const path = value.trim();
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('%')) {
    return false;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || /[?#]/.test(path)) return false;
  return path.split('/').every(segment => segment && segment !== '.' && segment !== '..');
}

function createGrainAbortError() {
  try {
    return new DOMException('Grain load was cancelled', 'AbortError');
  } catch (error) {
    const abortError = new Error('Grain load was cancelled');
    abortError.name = 'AbortError';
    return abortError;
  }
}

function assertGrainSourceCurrent(
  source,
  signal,
  revision = null,
  processingKey = null
) {
  if (
    signal?.aborted ||
    source.disposed ||
    source.sceneRequestId !== sceneLoadRequestId ||
    !staticSources.includes(source) ||
    (revision !== null && source.grainLoadRevision !== revision) ||
    (processingKey !== null && source.grainLoadingKey !== processingKey)
  ) {
    throw createGrainAbortError();
  }
}

async function fetchGrainJson(url, signal) {
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function decodeGrainEntry(
  source,
  entry,
  signal,
  revision,
  processingKey
) {
  const response = await fetch(source.grainRootUrl + entry.path, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(`${entry.path} returned HTTP ${response.status}`);
  }
  const encodedAudio = await response.arrayBuffer();
  assertGrainSourceCurrent(source, signal, revision, processingKey);
  const buffer = await audioCtx.decodeAudioData(encodedAudio);
  assertGrainSourceCurrent(source, signal, revision, processingKey);
  return {
    id: String(entry.id || entry.path),
    path: entry.path,
    buffer,
    rmsDbfs: Number(entry.features?.rms_dbfs),
  };
}

function computeAudioBufferRmsDbfs(buffer) {
  let energy = 0;
  let sampleCount = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) {
      energy += data[index] * data[index];
    }
    sampleCount += data.length;
  }
  const rms = Math.sqrt(energy / Math.max(1, sampleCount));
  return 20 * Math.log10(Math.max(rms, 1e-12));
}

async function fetchGrainNoiseProfile(source, dictionary, signal) {
  const profileConfig = dictionary?.noise_profile;
  const profilePath = profileConfig?.path;
  if (!isSafeRelativeAssetPath(profilePath)) {
    throw new Error(
      'spectral denoise requires dictionary noise_profile.path; ' +
      'run build_noise_profile.py first'
    );
  }
  const profile = await fetchGrainJson(source.grainRootUrl + profilePath, signal);
  if (
    profile?.format !== 'sound-grain-noise-profile' ||
    profile?.version !== 1 ||
    !Array.isArray(profile.noise_power_by_channel)
  ) {
    throw new Error('noise profile is not sound-grain-noise-profile v1');
  }
  return profile;
}

function createGrainPreprocessWorkerClient(settings, noiseProfile, signal) {
  if (typeof Worker !== 'function') {
    throw new Error('this browser does not support grain preprocessing workers');
  }
  const worker = new Worker(
    new URL('./grain-preprocess-worker.js', import.meta.url)
  );
  const pending = new Map();
  let nextJobId = 1;
  let closed = false;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  function fail(error) {
    if (closed) return;
    closed = true;
    signal?.removeEventListener('abort', abort);
    worker.terminate();
    const failure = error instanceof Error
      ? error
      : new Error(String(error));
    readyReject(failure);
    pending.forEach(({ reject }) => reject(failure));
    pending.clear();
  }
  function abort() {
    fail(createGrainAbortError());
  }
  signal?.addEventListener('abort', abort, { once: true });

  worker.onmessage = event => {
    const message = event.data || {};
    if (message.type === 'ready') {
      readyResolve();
      return;
    }
    if (message.type === 'error' && message.jobId == null) {
      fail(new Error(message.message || 'grain preprocessing worker failed'));
      return;
    }
    const job = pending.get(message.jobId);
    if (!job) return;
    pending.delete(message.jobId);
    if (message.type === 'result') job.resolve(message);
    else job.reject(new Error(message.message || 'grain preprocessing failed'));
  };
  worker.onerror = event => {
    fail(new Error(event.message || 'grain preprocessing worker crashed'));
  };
  try {
    worker.postMessage({
      type: 'init',
      settings,
      noiseProfile,
    });
  } catch (error) {
    fail(error);
  }

  return {
    ready,
    async process(buffer) {
      await ready;
      if (closed || signal?.aborted) throw createGrainAbortError();
      const jobId = nextJobId++;
      const channels = [];
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        channels.push(new Float32Array(buffer.getChannelData(channel)).buffer);
      }
      const result = new Promise((resolve, reject) => {
        pending.set(jobId, { resolve, reject });
      });
      try {
        worker.postMessage(
          {
            type: 'process',
            jobId,
            sampleRate: buffer.sampleRate,
            channels,
          },
          channels
        );
      } catch (error) {
        fail(error);
      }
      return result;
    },
    close() {
      if (closed) return;
      closed = true;
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      const error = createGrainAbortError();
      pending.forEach(({ reject }) => reject(error));
      pending.clear();
    },
  };
}

async function preprocessDecodedGrains(
  source,
  decoded,
  dictionary,
  settings,
  signal,
  revision
) {
  source.grainProcessingStage = 'preprocessing';
  source.grainProcessedCount = 0;
  updateGrainRenderingUi();

  const needsWorker =
    settings.windowKind !== 'none' || settings.denoiseKind !== 'none';
  if (!needsWorker) {
    for (let index = 0; index < decoded.length; index++) {
      assertGrainSourceCurrent(source, signal, revision, settings.key);
      const grain = decoded[index];
      if (grain) {
        grain.rmsDbfs = computeAudioBufferRmsDbfs(grain.buffer);
        grain.windowApplied = false;
        grain.denoiseApplied = false;
      }
      source.grainProcessedCount += 1;
      if (index % 8 === 7 || index === decoded.length - 1) {
        updateGrainRenderingUi();
        await new Promise(resolve => window.setTimeout(resolve, 0));
      }
    }
    return decoded;
  }

  const noiseProfile = settings.denoiseKind === 'spectral'
    ? await fetchGrainNoiseProfile(source, dictionary, signal)
    : null;
  assertGrainSourceCurrent(source, signal, revision, settings.key);
  const client = createGrainPreprocessWorkerClient(
    settings,
    noiseProfile,
    signal
  );
  try {
    await client.ready;
    for (let index = 0; index < decoded.length; index++) {
      assertGrainSourceCurrent(source, signal, revision, settings.key);
      const grain = decoded[index];
      if (grain) {
        const result = await client.process(grain.buffer);
        assertGrainSourceCurrent(source, signal, revision, settings.key);
        if (!Array.isArray(result.channels)) {
          throw new Error(`grain ${grain.id} preprocessing returned no channels`);
        }
        const channelData = result.channels.map(
          buffer => new Float32Array(buffer)
        );
        if (
          channelData.length !== grain.buffer.numberOfChannels ||
          channelData.some(data => data.length !== grain.buffer.length)
        ) {
          throw new Error(`grain ${grain.id} preprocessing returned invalid channels`);
        }
        const rmsDbfs = Number(result.rmsDbfs);
        if (!Number.isFinite(rmsDbfs)) {
          throw new Error(`grain ${grain.id} preprocessing returned invalid RMS`);
        }
        const processedBuffer = audioCtx.createBuffer(
          channelData.length,
          channelData[0].length,
          grain.buffer.sampleRate
        );
        channelData.forEach((data, channel) => {
          processedBuffer.getChannelData(channel).set(data);
        });
        grain.buffer = processedBuffer;
        grain.rmsDbfs = rmsDbfs;
        grain.windowApplied = settings.windowKind !== 'none';
        grain.denoiseApplied = settings.denoiseKind !== 'none';
      }
      source.grainProcessedCount += 1;
      updateGrainRenderingUi();
    }
    return decoded;
  } finally {
    client.close();
  }
}

async function ensureSourceGrains(source, processingSettings = getGrainProcessingSettings()) {
  if (
    source.grainState === 'ready' &&
    source.grainProcessingKey === processingSettings.key
  ) {
    return source.grainBuffers;
  }
  if (
    source.grainLoadPromise &&
    source.grainLoadingKey === processingSettings.key
  ) {
    return source.grainLoadPromise;
  }
  if (source.grainLoadPromise || source.grainState === 'ready') {
    clearSourceGrainCache(source);
  }
  if (!isSafeRelativeAssetPath(source.grainPath)) {
    source.grainState = 'error';
    source.grainError = 'grain_path must be a safe relative path';
    updateGrainRenderingUi();
    throw new Error(source.grainError);
  }

  source.grainState = 'loading';
  source.grainError = '';
  source.grainLoadedCount = 0;
  source.grainProcessedCount = 0;
  source.grainExpectedCount = 0;
  source.grainLoadFailures = 0;
  source.grainProcessingStage = 'decoding';
  const revision = (source.grainLoadRevision || 0) + 1;
  source.grainLoadRevision = revision;
  source.grainLoadingKey = processingSettings.key;
  const abortController = new AbortController();
  source.grainLoadAbortController = abortController;
  const { signal } = abortController;
  source.grainRootUrl = `${source.sceneBase.replace(/\/+$/, '')}/sound-grains/${source.grainPath}/`;
  updateGrainRenderingUi();

  let loadPromise;
  loadPromise = (async () => {
    try {
      const eldLoadPromise = ensureEldPointSamples(source).catch(error => {
        if (error?.name !== 'AbortError') {
          console.warn(`Grain ELD unavailable for ${source.displayName}:`, error);
        }
        return null;
      });
      const [dictionary, rateConfig] = await Promise.all([
        fetchGrainJson(source.grainRootUrl + 'dictionary.json', signal),
        fetchGrainJson(source.grainRootUrl + 'rate.json', signal),
      ]);
      assertGrainSourceCurrent(
        source,
        signal,
        revision,
        processingSettings.key
      );

      if (
        dictionary?.format !== 'sound-grain-dictionary' ||
        dictionary?.version !== 1 ||
        !dictionary.grains ||
        typeof dictionary.grains !== 'object'
      ) {
        throw new Error('dictionary.json is not a sound-grain-dictionary v1 file');
      }

      const entries = Object.values(dictionary.grains);
      if (!entries.length) throw new Error('dictionary.json contains no grains');
      if (entries.length > 4096) {
        throw new Error(`dictionary.json contains too many grains (${entries.length})`);
      }
      entries.forEach((entry, index) => {
        if (!entry || !isSafeRelativeAssetPath(entry.path)) {
          throw new Error(`grain entry ${index} has an unsafe relative path`);
        }
      });

      const requestedRate = Number(rateConfig?.poisson_rate);
      if (!Number.isFinite(requestedRate) || requestedRate <= 0) {
        throw new Error('rate.json poisson_rate must be a finite positive number');
      }
      const grainRateHz = Math.min(requestedRate, GRAIN_MAX_RATE_HZ);
      const grainRateWasClamped = requestedRate > GRAIN_MAX_RATE_HZ;
      source.grainExpectedCount = entries.length;
      updateGrainRenderingUi();

      let nextEntryIndex = 0;
      const decoded = new Array(entries.length);
      const workerCount = Math.min(GRAIN_LOAD_CONCURRENCY, entries.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (true) {
          assertGrainSourceCurrent(
            source,
            signal,
            revision,
            processingSettings.key
          );
          const entryIndex = nextEntryIndex++;
          if (entryIndex >= entries.length) return;
          try {
            decoded[entryIndex] = await decodeGrainEntry(
              source,
              entries[entryIndex],
              signal,
              revision,
              processingSettings.key
            );
            source.grainLoadedCount += 1;
          } catch (error) {
            if (error?.name === 'AbortError') throw error;
            source.grainLoadFailures += 1;
            console.warn(
              `Skipping grain ${entries[entryIndex].path} for ${source.displayName}:`,
              error
            );
          }
          updateGrainRenderingUi();
        }
      });
      await Promise.all(workers);
      await preprocessDecodedGrains(
        source,
        decoded,
        dictionary,
        processingSettings,
        signal,
        revision
      );
      await eldLoadPromise;
      assertGrainSourceCurrent(
        source,
        signal,
        revision,
        processingSettings.key
      );

      const processedGrains = decoded.filter(Boolean);
      if (!processedGrains.length) {
        throw new Error('none of the grain WAV files could be decoded');
      }
      const meanDuration = processedGrains.reduce(
        (total, grain) => total + grain.buffer.duration,
        0
      ) / processedGrains.length;
      const rmsLevels = processedGrains
        .map(grain => grain.rmsDbfs)
        .filter(Number.isFinite)
        .sort((left, right) => left - right);
      if (!rmsLevels.length) {
        throw new Error('grain preprocessing produced no finite RMS levels');
      }

      source.grainBuffers = processedGrains;
      source.grainRateHz = grainRateHz;
      source.grainRateWasClamped = grainRateWasClamped;
      source.grainMeanDurationSec = meanDuration;
      source.grainReferenceRmsDbfs = rmsLevels.length
        ? rmsLevels[Math.floor(rmsLevels.length / 2)]
        : null;
      source.grainOverlapGain = 1 / Math.sqrt(
        Math.max(1, grainRateHz * meanDuration)
      );
      source.grainProcessingKey = processingSettings.key;
      source.grainProcessingSettings = processingSettings;
      source.grainProcessingStage = '';
      source.grainState = 'ready';
      source.grainError = '';
      return source.grainBuffers;
    } catch (error) {
      const ownsLoad =
        source.grainLoadRevision === revision &&
        source.grainLoadingKey === processingSettings.key;
      if (ownsLoad) {
        source.grainProcessingStage = '';
        if (error?.name === 'AbortError') {
          if (!source.disposed) source.grainState = 'idle';
        } else {
          source.grainState = 'error';
          source.grainError = error?.message || String(error);
          console.error(`Failed to load grains for ${source.displayName}:`, error);
        }
      }
      throw error;
    } finally {
      const ownsLoad =
        source.grainLoadRevision === revision &&
        source.grainLoadingKey === processingSettings.key;
      if (ownsLoad && source.grainLoadAbortController === abortController) {
        source.grainLoadAbortController = null;
      }
      if (ownsLoad && source.grainLoadPromise === loadPromise) {
        source.grainLoadPromise = null;
        source.grainLoadingKey = null;
        updateGrainRenderingUi();
        syncEldControlState();
      }
    }
  })();
  source.grainLoadPromise = loadPromise;
  return loadPromise;
}

function randomGaussian() {
  const u1 = Math.max(Number.MIN_VALUE, Math.random());
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function sampleWeightedProfileLoudness(profile) {
  const target = Math.random() * profile.weightTotal;
  let cumulative = 0;
  let fallback = profile.mean;
  for (let index = 0; index < profile.sampleCount; index++) {
    const loudness = profile.loudnesses[index];
    const weight = getEldProfileWeight(profile, index);
    if (!Number.isFinite(loudness) || !(weight > 0)) continue;
    fallback = loudness;
    cumulative += weight;
    if (target <= cumulative) return loudness;
  }
  return fallback;
}

function sampleGrainEldLoudness(profile, settings) {
  if (settings.method === 'dummy-gaussian') {
    return settings.dummyMeanDb + randomGaussian() * settings.dummySigmaDb;
  }
  if (settings.method === 'gaussian') {
    return profile.mean + randomGaussian() * getEffectiveGaussianSigma(profile, settings);
  }
  const sample = sampleWeightedProfileLoudness(profile);
  if (settings.method === 'kde') {
    return sample + randomGaussian() * settings.kdeBandwidthDb;
  }
  const width = settings.histogramBinWidthDb;
  const binCenter = Math.floor((sample + width / 2) / width) * width;
  return binCenter + (Math.random() - 0.5) * width;
}

function refreshSourceGrainEldProfile(source, nowMs) {
  if (
    source.grainEldProfile &&
    nowMs - source.grainEldLastUpdateMs < GRAIN_ELD_REFRESH_MS
  ) {
    return;
  }
  source.grainEldLastUpdateMs = nowMs;
  source.grainEldProfile = computeSourceLoudnessProfile(source, camera.position);
}

function sampleGrainEldOffsetDb(source) {
  const profile = source.grainEldProfile;
  const settings = getEldSettings();
  if (settings.method !== 'dummy-gaussian' && !profile) return 0;
  const sampledLoudness = sampleGrainEldLoudness(profile, settings);
  // The event passes through the source's shared spatial gain after its own
  // envelope. Divide that gain back out in dB so the sampled ELD loudness is
  // the received event level instead of applying distance attenuation twice.
  const currentSpatialGain = Number(source.gain?.gain?.value);
  const sharedSpatialGain = Number.isFinite(currentSpatialGain)
    ? Math.max(1e-6, currentSpatialGain)
    : 1;
  const sharedSpatialGainDb = 20 * Math.log10(sharedSpatialGain);
  source.lastGrainEldSampleDb = sampledLoudness;
  source.lastGrainEldOffsetDb = sampledLoudness - sharedSpatialGainDb;
  return Math.max(
    -GRAIN_MAX_ELD_DEVIATION_DB,
    Math.min(GRAIN_MAX_ELD_DEVIATION_DB, source.lastGrainEldOffsetDb)
  );
}

function samplePoissonInterval(rateHz) {
  return -Math.log(Math.max(Number.MIN_VALUE, 1 - Math.random())) / rateHz;
}

function scheduleGrainEvent(source, eventTime) {
  const grains = source.grainBuffers;
  if (!grains?.length || !source.grainBus || source.disposed) return;
  const grain = grains[Math.floor(Math.random() * grains.length)];
  const playbackRate = Math.max(
    0.25,
    Math.min(4, source.currentPlaybackRate || 1)
  );
  const duration = grain.buffer.duration / playbackRate;
  const edgeFade = grain.windowApplied
    ? 0
    : Math.min(GRAIN_EDGE_FADE_SEC, duration / 3);
  const eldOffsetDb = sampleGrainEldOffsetDb(source);
  const rmsNormalizationDb = Number.isFinite(source.grainReferenceRmsDbfs) &&
    Number.isFinite(grain.rmsDbfs)
    ? source.grainReferenceRmsDbfs - grain.rmsDbfs
    : 0;
  const eventGain = Math.max(
    0.005,
    Math.min(
      4,
      source.grainOverlapGain * Math.pow(
        10,
        (rmsNormalizationDb + eldOffsetDb) / 20
      )
    )
  );

  const sourceNode = audioCtx.createBufferSource();
  const envelopeNode = audioCtx.createGain();
  sourceNode.buffer = grain.buffer;
  sourceNode.playbackRate.setValueAtTime(playbackRate, eventTime);
  sourceNode.connect(envelopeNode).connect(source.grainBus);
  if (edgeFade > 0) {
    envelopeNode.gain.setValueAtTime(0, eventTime);
    envelopeNode.gain.linearRampToValueAtTime(eventGain, eventTime + edgeFade);
    envelopeNode.gain.setValueAtTime(
      eventGain,
      Math.max(eventTime + edgeFade, eventTime + duration - edgeFade)
    );
    envelopeNode.gain.linearRampToValueAtTime(0, eventTime + duration);
  } else {
    envelopeNode.gain.setValueAtTime(eventGain, eventTime);
    envelopeNode.gain.setValueAtTime(eventGain, eventTime + duration);
    envelopeNode.gain.setValueAtTime(0, eventTime + duration + 0.001);
  }

  const record = { sourceNode, envelopeNode };
  source.activeGrains.add(record);
  sourceNode.onended = () => {
    source.activeGrains.delete(record);
    disconnectAudioNode(sourceNode);
    disconnectAudioNode(envelopeNode);
  };
  try {
    sourceNode.start(eventTime);
    sourceNode.stop(eventTime + duration + 0.01);
  } catch (error) {
    source.activeGrains.delete(record);
    disconnectAudioNode(sourceNode);
    disconnectAudioNode(envelopeNode);
    console.warn(`Could not schedule grain ${grain.id}:`, error);
  }
}

function runGrainSchedulerTick() {
  if (!grainRenderingEnabled || !audioCtx || audioCtx.state !== 'running') return;
  const now = audioCtx.currentTime;
  const earliestStart = now + GRAIN_SCHEDULER_START_LEAD_SEC;
  const horizon = now + GRAIN_SCHEDULER_LOOKAHEAD_SEC;
  const nowMs = performance.now();

  getGrainCapableSources().forEach(source => {
    if (source.grainState !== 'ready' || !(source.grainRateHz > 0)) return;
    refreshSourceGrainEldProfile(source, nowMs);
    if (
      !Number.isFinite(source.nextGrainTime) ||
      source.nextGrainTime < earliestStart
    ) {
      source.nextGrainTime = earliestStart + samplePoissonInterval(source.grainRateHz);
    }

    let eventCount = 0;
    while (
      source.nextGrainTime <= horizon &&
      eventCount < GRAIN_MAX_EVENTS_PER_TICK
    ) {
      scheduleGrainEvent(source, source.nextGrainTime);
      source.nextGrainTime += samplePoissonInterval(source.grainRateHz);
      eventCount += 1;
    }
    if (eventCount >= GRAIN_MAX_EVENTS_PER_TICK && source.nextGrainTime <= horizon) {
      source.nextGrainTime = horizon + samplePoissonInterval(source.grainRateHz);
    }
  });
}

function startGrainScheduler() {
  stopGrainScheduler();
  runGrainSchedulerTick();
  grainSchedulerTimer = window.setInterval(
    runGrainSchedulerTick,
    GRAIN_SCHEDULER_INTERVAL_MS
  );
}

async function loadGrainsForContentMode(targetMode, { forceReload = false } = {}) {
  if (!['loop', 'grain'].includes(targetMode)) {
    throw new Error(`unsupported source content mode: ${String(targetMode)}`);
  }
  const sources = getGrainCapableSources();
  if (!sources.length || !audioCtx) {
    updateGrainRenderingUi();
    return false;
  }
  const processingSettings = getGrainProcessingSettings();
  const generation = ++grainModeGeneration;
  grainRenderingEnabled = false;
  stopGrainScheduler();
  staticSources.forEach(source => {
    source.nextGrainTime = null;
    silenceSourceContentBuses(source);
    stopActiveGrains(source);
  });
  if (forceReload) sources.forEach(clearSourceGrainCache);
  updateGrainRenderingUi();

  const results = await Promise.allSettled(
    sources.map(source => ensureSourceGrains(source, processingSettings))
  );
  if (generation !== grainModeGeneration) return false;

  const readySources = sources.filter(
    source =>
      !source.disposed &&
      source.grainState === 'ready' &&
      source.grainProcessingKey === processingSettings.key
  );
  if (readySources.length !== sources.length) {
    const firstFailure = results.find(result => result.status === 'rejected');
    if (firstFailure?.reason?.name !== 'AbortError') {
      console.error('Grain preprocessing did not complete.', firstFailure?.reason);
    }
    updateGrainRenderingUi();
    return false;
  }

  grainRenderingEnabled = targetMode === 'grain';
  staticSources.forEach(source => {
    const useGrains = grainRenderingEnabled && readySources.includes(source);
    if (useGrains) stopActiveGrains(source);
    source.nextGrainTime = null;
    setSourceContentBusGains(source, useGrains);
  });
  if (grainRenderingEnabled) startGrainScheduler();
  updateGrainRenderingUi();
  return true;
}

async function activateGrainRendering() {
  grainRequestedContentMode = 'grain';
  return loadGrainsForContentMode('grain');
}

async function reloadGrainsForProcessing() {
  return loadGrainsForContentMode(
    grainRequestedContentMode,
    { forceReload: true }
  );
}

function getEldMethodSupport(profiles, settings) {
  if (settings.method === 'dummy-gaussian') {
    const tail = ELD_TAIL_SIGMAS * settings.dummySigmaDb;
    return {
      minimum: settings.dummyMeanDb - tail,
      maximum: settings.dummyMeanDb + tail,
    };
  }
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  if (settings.method === 'gaussian') {
    profiles.forEach(profile => {
      const sigma = getEffectiveGaussianSigma(profile, settings);
      minimum = Math.min(minimum, profile.mean - ELD_TAIL_SIGMAS * sigma);
      maximum = Math.max(maximum, profile.mean + ELD_TAIL_SIGMAS * sigma);
    });
  } else if (settings.method === 'kde') {
    const tail = ELD_TAIL_SIGMAS * settings.kdeBandwidthDb;
    profiles.forEach(profile => {
      minimum = Math.min(minimum, profile.minimum - tail);
      maximum = Math.max(maximum, profile.maximum + tail);
    });
  } else {
    const width = settings.histogramBinWidthDb;
    profiles.forEach(profile => {
      const firstBin = Math.floor((profile.minimum + width / 2) / width) - 1;
      const lastBin = Math.floor((profile.maximum + width / 2) / width) + 1;
      minimum = Math.min(minimum, (firstBin - 0.5) * width);
      maximum = Math.max(maximum, (lastBin + 0.5) * width);
    });
  }
  if (!Number.isFinite(minimum) || !(maximum > minimum)) {
    return { minimum: -3, maximum: 3 };
  }
  return { minimum, maximum };
}

function resolveEldXRange(support, settings) {
  const dataCenter = (support.minimum + support.maximum) / 2;
  const dataSpan = Math.max(
    support.maximum - support.minimum,
    ELD_MIN_ADAPTIVE_X_SPAN_DB
  );
  const center = settings.xPositionMode === 'adaptive'
    ? dataCenter
    : settings.fixedXCenterDb;
  let span;
  if (settings.xLengthMode === 'fixed') {
    span = settings.fixedXSpanDb;
  } else if (settings.xPositionMode === 'fixed') {
    span = Math.max(
      ELD_MIN_ADAPTIVE_X_SPAN_DB,
      2 * Math.max(
        Math.abs(support.minimum - center),
        Math.abs(support.maximum - center)
      )
    );
  } else {
    span = dataSpan;
  }
  return {
    minimum: center - span / 2,
    maximum: center + span / 2,
    center,
    span,
  };
}

function getContinuousEldSampleCount(xRange, featureWidth) {
  const targetStep = Math.max(0.01, featureWidth / 3);
  const requested = Math.ceil(xRange.span / targetStep) + 1;
  return Math.max(
    ELD_CURVE_SAMPLE_COUNT,
    Math.min(ELD_MAX_CURVE_SAMPLE_COUNT, requested)
  );
}

function makeEldXValues(xMinimum, xMaximum, sampleCount) {
  const values = new Float64Array(sampleCount);
  for (let index = 0; index < values.length; index++) {
    values[index] = xMinimum +
      (xMaximum - xMinimum) * index / (values.length - 1);
  }
  return values;
}

function buildHistogramEldChart(profiles, xRange, settings) {
  const binWidth = settings.histogramBinWidthDb;
  const firstBin = Math.floor((xRange.minimum + binWidth / 2) / binWidth);
  const lastBin = Math.ceil((xRange.maximum + binWidth / 2) / binWidth) - 1;
  const binCount = Math.max(1, lastBin - firstBin + 1);
  const curves = profiles.map(profile => {
    const values = new Float64Array(binCount);
    for (let index = 0; index < profile.sampleCount; index++) {
      const loudness = profile.loudnesses[index];
      const weight = getEldProfileWeight(profile, index);
      if (!Number.isFinite(loudness) || !(weight > 0)) continue;
      const absoluteBin = Math.floor((loudness + binWidth / 2) / binWidth);
      const binIndex = absoluteBin - firstBin;
      if (binIndex >= 0 && binIndex < binCount) {
        values[binIndex] += weight / profile.weightTotal / binWidth;
      }
    }
    return { item: profile, values };
  });
  return {
    kind: 'step',
    curves,
    firstBin,
    binWidth,
    xMinimum: xRange.minimum,
    xMaximum: xRange.maximum,
  };
}

function gaussianDensity(value, mean, sigma) {
  const offset = (value - mean) / sigma;
  if (Math.abs(offset) > 8) return 0;
  return Math.exp(-0.5 * offset * offset) /
    (sigma * Math.sqrt(2 * Math.PI));
}

function buildDummyGaussianEldChart(profiles, xRange, settings) {
  const xValues = makeEldXValues(
    xRange.minimum,
    xRange.maximum,
    getContinuousEldSampleCount(xRange, settings.dummySigmaDb)
  );
  return {
    kind: 'line',
    curves: profiles.slice(0, 1).map(profile => ({
      item: profile,
      values: Float64Array.from(
        xValues,
        value => gaussianDensity(
          value,
          settings.dummyMeanDb,
          settings.dummySigmaDb
        )
      ),
    })),
    xValues,
    xMinimum: xRange.minimum,
    xMaximum: xRange.maximum,
  };
}

function buildGaussianEldChart(profiles, xRange, settings) {
  const minimumSigma = Math.min(
    ...profiles.map(profile => getEffectiveGaussianSigma(profile, settings))
  );
  const xValues = makeEldXValues(
    xRange.minimum,
    xRange.maximum,
    getContinuousEldSampleCount(xRange, minimumSigma)
  );
  const curves = profiles.map(profile => {
    const sigma = getEffectiveGaussianSigma(profile, settings);
    const values = Float64Array.from(
      xValues,
      value => gaussianDensity(value, profile.mean, sigma)
    );
    return { item: profile, values };
  });
  return {
    kind: 'line',
    curves,
    xValues,
    xMinimum: xRange.minimum,
    xMaximum: xRange.maximum,
  };
}

function buildKdeEldCurve(profile, xValues, bandwidth) {
  const values = new Float64Array(xValues.length);
  const xStep = xValues[1] - xValues[0];
  const massStep = Math.max(0.02, Math.min(bandwidth / 4, xStep));
  const massBins = new Map();
  for (let index = 0; index < profile.sampleCount; index++) {
    const loudness = profile.loudnesses[index];
    const weight = getEldProfileWeight(profile, index);
    if (!Number.isFinite(loudness) || !(weight > 0)) continue;
    const massBin = Math.round(loudness / massStep);
    massBins.set(massBin, (massBins.get(massBin) || 0) + weight);
  }
  const normalizer = 1 /
    (profile.weightTotal * bandwidth * Math.sqrt(2 * Math.PI));
  const tail = ELD_TAIL_SIGMAS * bandwidth;
  massBins.forEach((mass, massBin) => {
    const center = massBin * massStep;
    const firstIndex = Math.max(
      0,
      Math.ceil((center - tail - xValues[0]) / xStep)
    );
    const lastIndex = Math.min(
      xValues.length - 1,
      Math.floor((center + tail - xValues[0]) / xStep)
    );
    for (let index = firstIndex; index <= lastIndex; index++) {
      const offset = (xValues[index] - center) / bandwidth;
      values[index] += mass * normalizer * Math.exp(-0.5 * offset * offset);
    }
  });
  return values;
}

function buildKdeEldChart(profiles, xRange, settings) {
  const xValues = makeEldXValues(
    xRange.minimum,
    xRange.maximum,
    getContinuousEldSampleCount(xRange, settings.kdeBandwidthDb)
  );
  const curves = profiles.map(profile => ({
    item: profile,
    values: buildKdeEldCurve(
      profile,
      xValues,
      settings.kdeBandwidthDb
    ),
  }));
  return {
    kind: 'line',
    curves,
    xValues,
    xMinimum: xRange.minimum,
    xMaximum: xRange.maximum,
  };
}

function buildEldChartData(profiles, xRange, settings) {
  if (settings.method === 'dummy-gaussian') {
    return buildDummyGaussianEldChart(profiles, xRange, settings);
  }
  if (settings.method === 'gaussian') {
    return buildGaussianEldChart(profiles, xRange, settings);
  }
  if (settings.method === 'kde') {
    return buildKdeEldChart(profiles, xRange, settings);
  }
  return buildHistogramEldChart(profiles, xRange, settings);
}

function traceEldCurve(
  context,
  chartData,
  values,
  xToCanvas,
  yToCanvas,
  continuePath = false
) {
  if (!values.length) return;
  const startX = chartData.xMinimum;
  const startY = values[0];
  if (continuePath) context.lineTo(xToCanvas(startX), yToCanvas(startY));
  else context.moveTo(xToCanvas(startX), yToCanvas(startY));

  if (chartData.kind === 'step') {
    for (let index = 0; index < values.length; index++) {
      const absoluteBin = chartData.firstBin + index;
      const binRight = (absoluteBin + 0.5) * chartData.binWidth;
      const rightEdge = Math.min(chartData.xMaximum, binRight);
      context.lineTo(xToCanvas(rightEdge), yToCanvas(values[index]));
      if (index + 1 < values.length && rightEdge < chartData.xMaximum) {
        context.lineTo(xToCanvas(rightEdge), yToCanvas(values[index + 1]));
      }
    }
    return;
  }

  for (let index = 1; index < values.length; index++) {
    context.lineTo(
      xToCanvas(chartData.xValues[index]),
      yToCanvas(values[index])
    );
  }
}

function getNiceEldTicks(minimum, maximum, targetCount = 6) {
  const range = maximum - minimum;
  const roughStep = range / targetCount;
  const power = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / power;
  const multiplier = normalized <= 1
    ? 1
    : normalized <= 2
      ? 2
      : normalized <= 5
        ? 5
        : 10;
  const step = multiplier * power;
  const first = Math.ceil((minimum - step * 1e-9) / step) * step;
  const values = [];
  for (let value = first; value <= maximum + step * 1e-9; value += step) {
    values.push(Math.abs(value) < step * 1e-9 ? 0 : value);
    if (values.length > 20) break;
  }
  return { values, step };
}

function formatEldAxisValue(value, step) {
  let decimals = 0;
  if (step < 1) {
    decimals = Math.min(2, Math.ceil(-Math.log10(step)) + 1);
  } else if (Math.abs(step - Math.round(step)) > 1e-6) {
    decimals = 1;
  }
  return value.toFixed(decimals);
}

function computeVisibleEldIntegral(chartData, values) {
  if (chartData.kind === 'step') {
    let integral = 0;
    for (let index = 0; index < values.length; index++) {
      const absoluteBin = chartData.firstBin + index;
      const left = Math.max(
        chartData.xMinimum,
        (absoluteBin - 0.5) * chartData.binWidth
      );
      const right = Math.min(
        chartData.xMaximum,
        (absoluteBin + 0.5) * chartData.binWidth
      );
      integral += values[index] * Math.max(0, right - left);
    }
    return integral;
  }
  let integral = 0;
  for (let index = 1; index < values.length; index++) {
    const width = chartData.xValues[index] - chartData.xValues[index - 1];
    integral += 0.5 * (values[index - 1] + values[index]) * width;
  }
  return integral;
}

function formatEldRangeValue(value) {
  const normalized = Math.abs(value) < 0.05 ? 0 : value;
  return normalized.toFixed(1).replace(/\.0$/, '');
}

function getEldMethodSummary(settings) {
  if (settings.method === 'dummy-gaussian') {
    return 'Dummy Gaussian μ ' + settings.dummyMeanDb.toFixed(1) + ' dB' +
      ', σ ' + settings.dummySigmaDb.toFixed(1) + ' dB';
  }
  if (settings.method === 'gaussian') {
    return 'Gaussian σ×' + settings.gaussianSigmaScale.toFixed(1) +
      ', min ' + settings.gaussianSigmaFloorDb.toFixed(1) + ' dB';
  }
  if (settings.method === 'kde') {
    return 'KDE h=' + settings.kdeBandwidthDb.toFixed(1) + ' dB';
  }
  return 'Histogram Δ=' + settings.histogramBinWidthDb.toFixed(1) + ' dB';
}

function drawEldChart(profiles) {
  const canvas = prepareEldCanvas();
  if (!canvas) return;
  const { context, width, height } = canvas;
  const margin = { left: 50, right: 13, top: 13, bottom: 40 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const settings = getEldSettings();
  const isDummyGaussian = settings.method === 'dummy-gaussian';
  const support = getEldMethodSupport(profiles, settings);
  const xRange = resolveEldXRange(support, settings);
  const chartData = buildEldChartData(profiles, xRange, settings);
  const curves = chartData.curves;
  const totalValues = new Float64Array(curves[0].values.length);
  curves.forEach(curve => {
    curve.values.forEach((value, index) => {
      totalValues[index] += value;
    });
  });

  if (eldResolvedRange) {
    eldResolvedRange.textContent = 'X: ' +
      formatEldRangeValue(xRange.minimum) + '…' +
      formatEldRangeValue(xRange.maximum) + ' dB';
  }

  const yMaximum = Math.max(...totalValues) * 1.08 || 1;
  const xToCanvas = value => margin.left +
    (value - xRange.minimum) / xRange.span * plotWidth;
  const yToCanvas = value => margin.top +
    (1 - value / yMaximum) * plotHeight;

  context.fillStyle = 'rgba(255, 255, 255, 0.025)';
  context.fillRect(margin.left, margin.top, plotWidth, plotHeight);
  context.font = '9px Inter, sans-serif';
  context.lineWidth = 1;
  context.textBaseline = 'middle';

  for (let tick = 0; tick <= 4; tick++) {
    const value = yMaximum * tick / 4;
    const y = yToCanvas(value);
    context.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    context.beginPath();
    context.moveTo(margin.left, y);
    context.lineTo(width - margin.right, y);
    context.stroke();
    context.fillStyle = 'rgba(255, 255, 255, 0.42)';
    context.textAlign = 'right';
    const densityDecimals = yMaximum < 0.1 ? 3 : 2;
    context.fillText(value.toFixed(densityDecimals), margin.left - 6, y);
  }

  const xTicks = getNiceEldTicks(xRange.minimum, xRange.maximum);
  xTicks.values.forEach(value => {
    const x = xToCanvas(value);
    context.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    context.beginPath();
    context.moveTo(x, margin.top);
    context.lineTo(x, margin.top + plotHeight);
    context.stroke();
    context.fillStyle = 'rgba(255, 255, 255, 0.48)';
    context.textAlign = 'center';
    context.fillText(
      formatEldAxisValue(value, xTicks.step),
      x,
      margin.top + plotHeight + 13
    );
  });

  context.fillStyle = 'rgba(255, 255, 255, 0.58)';
  context.textAlign = 'center';
  context.fillText(
    'Relative loudness (dB re 1 scene unit)',
    margin.left + plotWidth / 2,
    height - 9
  );
  context.save();
  context.translate(11, margin.top + plotHeight / 2);
  context.rotate(-Math.PI / 2);
  context.fillText('Relative ELD (/dB)', 0, 0);
  context.restore();

  if (profiles.length > 1) {
    context.beginPath();
    context.moveTo(xToCanvas(xRange.minimum), yToCanvas(0));
    traceEldCurve(
      context,
      chartData,
      totalValues,
      xToCanvas,
      yToCanvas,
      true
    );
    context.lineTo(xToCanvas(xRange.maximum), yToCanvas(0));
    context.closePath();
    context.fillStyle = 'rgba(255, 255, 255, 0.055)';
    context.fill();
  }

  curves.forEach(curve => {
    context.beginPath();
    traceEldCurve(
      context,
      chartData,
      curve.values,
      xToCanvas,
      yToCanvas
    );
    context.strokeStyle = curve.item.source.chartColor;
    context.lineWidth = profiles.length === 1 ? 2.2 : 1.35;
    context.globalAlpha = profiles.length === 1 ? 1 : 0.78;
    context.stroke();
  });
  context.globalAlpha = 1;

  if (profiles.length > 1) {
    context.beginPath();
    traceEldCurve(
      context,
      chartData,
      totalValues,
      xToCanvas,
      yToCanvas
    );
    context.strokeStyle = 'rgba(255, 255, 255, 0.94)';
    context.lineWidth = 2.2;
    context.stroke();
    context.fillStyle = 'rgba(255, 255, 255, 0.72)';
    context.textAlign = 'right';
    context.fillText('sum', width - margin.right - 4, margin.top + 9);
  }

  const combinedMean = profiles.reduce((sum, item) => sum + item.mean, 0) /
    profiles.length;
  const combinedVariance = profiles.reduce(
    (sum, item) => sum + item.variance + (item.mean - combinedMean) ** 2,
    0
  ) / profiles.length;
  const combinedSigma = Math.sqrt(Math.max(0, combinedVariance));
  const visibleIntegral = computeVisibleEldIntegral(chartData, totalValues);
  const sourceLabel = profiles.length + ' source' +
    (profiles.length === 1 ? '' : 's');
  const summary = getEldMethodSummary(settings) + ' · ' + sourceLabel +
    (isDummyGaussian
      ? ''
      : ' · sample μ ' + combinedMean.toFixed(2) + ' dB' +
        ' · sample σ ' + combinedSigma.toFixed(2) + ' dB') +
    ' · visible ∫E ' + visibleIntegral.toFixed(2) +
    '/' + profiles.length.toFixed(0);
  eldStats.textContent = summary;
  eldCanvas.setAttribute(
    'aria-label',
    'Event loudness density. ' + summary
  );
}

function resetEldInspector(message = 'Load a scene to inspect its sources.') {
  selectedEldSourceIds.clear();
  eldDirty = true;
  eldLastUpdateMs = -Infinity;
  eldLastCameraPosition.set(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY
  );
  if (eldSourceList) {
    eldSourceList.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'eld-empty';
    empty.textContent = message;
    eldSourceList.appendChild(empty);
  }
  if (eldStats) eldStats.textContent = 'No source selected.';
  if (eldResolvedRange) eldResolvedRange.textContent = 'X: awaiting data';
  if (eldToggleButton) eldToggleButton.disabled = true;
  syncEldControlState();
  drawEldPlaceholder(message);
}

async function handleEldSourceSelection(source, checkbox) {
  if (!checkbox.checked) {
    selectedEldSourceIds.delete(source.sourceId);
    eldDirty = true;
    return;
  }

  selectedEldSourceIds.add(source.sourceId);
  eldDirty = true;
  try {
    await ensureEldPointSamples(source);
    eldDirty = true;
  } catch (error) {
    console.error(`Failed to load ELD data for ${source.displayName}:`, error);
    checkbox.checked = false;
    selectedEldSourceIds.delete(source.sourceId);
    eldStats.textContent = `Could not load ${source.displayName}.`;
    eldDirty = true;
  }
}

function selectAllEldSources() {
  if (selectedEldSourceIds.size || !eldSourceList) return;
  eldSourceList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
  });
}

function rebuildEldSourceList() {
  if (!eldSourceList || !eldToggleButton) return;
  selectedEldSourceIds.clear();
  eldSourceList.replaceChildren();

  if (!staticSources.length) {
    resetEldInspector();
    return;
  }

  staticSources.forEach(source => {
    const label = document.createElement('label');
    label.className = 'eld-source-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = source.sourceId;
    checkbox.disabled = isUiLocked;
    checkbox.addEventListener('change', () => {
      handleEldSourceSelection(source, checkbox);
    });
    const swatch = document.createElement('span');
    swatch.className = 'eld-source-swatch';
    swatch.style.setProperty('--eld-source-color', source.chartColor);
    const name = document.createElement('span');
    name.className = 'eld-source-name';
    name.textContent = source.displayName;
    source.eldOptionNameElement = name;
    label.append(checkbox, swatch, name);
    eldSourceList.appendChild(label);
  });

  eldToggleButton.disabled = isUiLocked;
  eldStats.textContent = 'Select one or more source point clouds.';
  eldDirty = true;
  syncEldControlState();
  if (!eldWindow.hidden) selectAllEldSources();
}

function setEldWindowOpen(isOpen) {
  if (!eldWindow || !eldToggleButton) return;
  const shouldRestoreFocus = !isOpen && eldWindow.contains(document.activeElement);
  eldWindow.hidden = !isOpen;
  eldToggleButton.setAttribute('aria-expanded', String(isOpen));
  eldToggleButton.textContent = isOpen ? 'Close ELD Inspector' : 'Open ELD Inspector';
  if (isOpen) {
    eldDirty = true;
    selectAllEldSources();
    requestAnimationFrame(() => updateEldInspector(performance.now(), true));
  } else if (shouldRestoreFocus) {
    eldToggleButton.focus();
  }
}

function updateEldInspector(timestamp, force = false) {
  if (!eldWindow || eldWindow.hidden) return;
  const cameraMoved = camera.position.distanceToSquared(
    eldLastCameraPosition
  ) > ELD_CAMERA_MOVE_EPSILON_SQ;
  if (!force && timestamp - eldLastUpdateMs < ELD_UPDATE_INTERVAL_MS) return;
  if (!force && !eldDirty && !cameraMoved) return;

  const selectedSources = staticSources.filter(source =>
    selectedEldSourceIds.has(source.sourceId)
  );
  const readySources = selectedSources.filter(source => source.eldSamples);
  const settings = getEldSettings();
  const dummyAvailability = getDummyEldAvailability();
  if (settings.method === 'dummy-gaussian' && dummyAvailability.available) {
    drawEldChart([{
      source: dummyAvailability.source,
      mean: settings.dummyMeanDb,
      variance: settings.dummySigmaDb ** 2,
    }]);
  } else if (!selectedSources.length) {
    drawEldPlaceholder('Select one or more source point clouds.');
    eldStats.textContent = 'No source selected.';
    if (eldResolvedRange) eldResolvedRange.textContent = 'X: awaiting data';
  } else if (!readySources.length) {
    drawEldPlaceholder('Loading full point-cloud statistics…');
    eldStats.textContent = 'Loading selected source data…';
    if (eldResolvedRange) eldResolvedRange.textContent = 'X: loading';
  } else {
    const profiles = readySources
      .map(source => computeSourceLoudnessProfile(source, camera.position))
      .filter(Boolean);
    if (profiles.length) drawEldChart(profiles);
  }

  eldDirty = false;
  eldLastUpdateMs = timestamp;
  eldLastCameraPosition.copy(camera.position);
}

if (eldToggleButton) {
  eldToggleButton.addEventListener('click', () => {
    if (isUiLocked || eldToggleButton.disabled) return;
    setEldWindowOpen(eldWindow.hidden);
  });
}
if (eldCloseButton) {
  eldCloseButton.addEventListener('click', () => setEldWindowOpen(false));
}
if (eldWindow) {
  eldWindow.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') setEldWindowOpen(false);
  });
  eldWindow.addEventListener('keyup', event => event.stopPropagation());
}

const eldNumericControlConfigs = [
  [eldHistogramBinWidthInput, ELD_DEFAULT_BIN_WIDTH_DB, 0.1, 24],
  [eldKdeBandwidthInput, ELD_DEFAULT_KDE_BANDWIDTH_DB, 0.1, 24],
  [eldGaussianSigmaScaleInput, ELD_DEFAULT_GAUSSIAN_SIGMA_SCALE, 0.1, 10],
  [eldGaussianSigmaFloorInput, ELD_DEFAULT_GAUSSIAN_SIGMA_FLOOR_DB, 0.1, 24],
  [eldDummyMeanInput, ELD_DEFAULT_DUMMY_MEAN_DB, -120, 24],
  [
    eldDummySigmaInput,
    ELD_DEFAULT_DUMMY_SIGMA_DB,
    ELD_MIN_DUMMY_SIGMA_DB,
    ELD_MAX_DUMMY_SIGMA_DB,
  ],
  [eldXSpanInput, ELD_DEFAULT_FIXED_X_SPAN_DB, 1, 240],
  [eldXCenterInput, ELD_DEFAULT_FIXED_X_CENTER_DB, -300, 100],
];

eldNumericControlConfigs.forEach(([input, fallback, minimum, maximum]) => {
  if (!input) return;
  input.addEventListener('input', () => {
    eldDirty = true;
  });
  input.addEventListener('change', () => {
    input.value = String(readEldNumber(input, fallback, minimum, maximum));
    eldDirty = true;
  });
});

[eldMethodSelect, eldXLengthModeSelect, eldXPositionModeSelect].forEach(
  select => {
    if (!select) return;
    select.addEventListener('change', () => {
      syncEldControlState();
      eldDirty = true;
      updateGrainRenderingUi();
    });
  }
);

[eldDummyMeanInput, eldDummySigmaInput].forEach(input => {
  if (!input) return;
  input.addEventListener('input', () => {
    syncEldControlState();
    updateGrainRenderingUi();
  });
  input.addEventListener('change', () => {
    syncEldControlState();
    updateGrainRenderingUi();
  });
});

syncEldControlState();

if (eldCanvas && 'ResizeObserver' in window) {
  new ResizeObserver(() => {
    eldDirty = true;
  }).observe(eldCanvas);
}
// =================================

document.getElementById('toggleVolumeAudio').addEventListener('click', function () {
  if (isUiLocked) return;
  volumeAudio = !volumeAudio;
  this.textContent = volumeAudio ? 'Volume Audio' : 'Point Audio';
});

function handleGrainProcessingControlChange() {
  syncGrainPreprocessingUi();
  if (isUiLocked || !getGrainCapableSources().length) {
    updateGrainRenderingUi();
    return;
  }
  reloadGrainsForProcessing().catch(error => {
    if (error?.name !== 'AbortError') {
      console.error('Could not reload grains for preprocessing:', error);
    }
    updateGrainRenderingUi();
  });
}

[grainWindowKindSelect, grainDenoiseKindSelect].forEach(select => {
  select?.addEventListener('change', handleGrainProcessingControlChange);
});

[
  [grainWindowAlphaInput, GRAIN_DEFAULT_WINDOW_ALPHA, 0, 1],
  [grainDenoiseStrengthInput, GRAIN_DEFAULT_DENOISE_STRENGTH, 0, 100],
  [grainDenoiseMaxAttenInput, GRAIN_DEFAULT_DENOISE_MAX_ATTEN_DB, 0, 60],
].forEach(([input, fallback, minimum, maximum]) => {
  input?.addEventListener('change', () => {
    input.value = String(
      readGrainProcessingNumber(input, fallback, minimum, maximum)
    );
    handleGrainProcessingControlChange();
  });
});

if (grainToggleButton) {
  grainToggleButton.addEventListener('click', () => {
    if (isUiLocked) return;
    if (grainRenderingEnabled) {
      deactivateGrainRendering();
      return;
    }
    const hasFailedLoad = getGrainCapableSources().some(
      source => source.grainState === 'error'
    );
    const action = hasFailedLoad
      ? reloadGrainsForProcessing()
      : activateGrainRendering();
    action.catch(error => {
      if (error?.name !== 'AbortError') {
        console.error('Could not load grain assets:', error);
      }
      updateGrainRenderingUi();
    });
  });
}

const hrirBtn = document.getElementById('toggleHRIR');
// hrirBtn.addEventListener('click', function () {
//   if (hrirBuffers) {
//     useHRIR = !useHRIR;
//     this.textContent = useHRIR ? 'HRIR Binaural (ON)' : 'Stereo Panning';
//   }
// });
if (hrirBtn) {
  hrirBtn.addEventListener('click', function () {
    if (isUiLocked) return;
    if (hrirBuffers) {
      useHRIR = !useHRIR;
      this.textContent = useHRIR ? 'HRIR Binaural (ON)' : 'Stereo Panning';
    }
  });
}
document.getElementById('toggleStaticSourceVisibility').addEventListener('click', () => {
  if (isUiLocked) return;
  centroidVisible = !centroidVisible;

  staticSources.forEach(s => {
    if (s.centroid) {
      s.centroid.visible = centroidVisible;
    }
    if (s.label) {
      s.label.visible = centroidVisible || sourceVisible;
    }
  });
});
document.getElementById('toggleClusterVisibility').addEventListener('click', () => {
  if (isUiLocked) return;
  sourceVisible = !sourceVisible;

  staticSources.forEach(s => {
    if (s.points) {
      s.points.visible = sourceVisible;
    }
    if (s.label) {
      s.label.visible = centroidVisible || sourceVisible;
    }
  });
});
document.getElementById('goToOrigin').addEventListener('click', () => {
  if (isUiLocked) return;

  camera.position.set(0, 0, 0);
  yaw = 0;
  pitch = 0;
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
  prevPos.copy(camera.position);
});

function loadPlyAsPoints(url, opts = {}) {
  const {
    size = 0.1,
    vertexColors = undefined,
    color = Math.random() * 0xffffff,
  } = opts;

  return new Promise((resolve, reject) => {
    const loader = new PLYLoader();
    loader.load(
      url,
      geometry => {
        const useVertexColors =
          vertexColors !== undefined
            ? vertexColors
            : geometry.hasAttribute('color');

        let finalColor = color;

        const material = new THREE.PointsMaterial({
          size,
          color,
          vertexColors: useVertexColors
        });

        const points = new THREE.Points(geometry, material);
        points.visible = sourceVisible;
        resolve({ points, color: finalColor });
      },
      xhr => {},
      err => reject(new Error(`Load PLY failed: ${err.message}`))
    );
  });
}

async function loadStaticSourceList(basePath, requestId) {
  if (requestId !== sceneLoadRequestId) return;
  resetEldInspector('Loading scene sources…');
  if (staticSources.length > 0) {
    staticSources.forEach(source => disposeStaticSource(source, true));
    staticSources.length = 0;
    updateGrainRenderingUi();
  }

  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 48000
    });
    updatePlayButton();
    updateAudioMetrics(); // ==== NEW: 初始化时更新一次 ====

    // Bundled scenes use stereo panning; no HRIR assets are required.
    if (hrirBtn) {
      hrirBtn.textContent = 'Stereo Panning';
      hrirBtn.disabled = true;
    }
  } else {
    updateAudioMetrics(); // ==== NEW: 再 load 场景时也更新一下 ====
  }

  const jsonPath = basePath + (basePath.endsWith('/') ? '' : '/') + 'render_cfg/choice.json';
  const audioDir = basePath + (basePath.endsWith('/') ? '' : '/') + 'audio/';
  const groundingDir = basePath + (basePath.endsWith('/') ? '' : '/') + 'render_cfg/';

  let list;
  try {
    const response = await fetch(jsonPath, { cache: 'no-store' });
    if (requestId !== sceneLoadRequestId) return;
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    list = await response.json();
    if (requestId !== sceneLoadRequestId) return;
  } catch (err) {
    throw new Error(`Could not load ${jsonPath}: ${err.message}`);
  }
  if (!Array.isArray(list) || !list.some(source => source.class_label !== 'global')) {
    throw new Error(`No playable sources in ${jsonPath}`);
  }

  for (const [sourceIndex, sourceConfig] of list.entries()) {
    const {
      class_label,
      centroid,
      pcd,
      pcd_points,
      pcd_weights,
      audio_path,
      grain_path,
    } = sourceConfig;

    if (class_label === 'global') {
      continue;
    }

    const audioResponse = await fetch(audioDir + audio_path, { cache: 'no-store' });
    if (!audioResponse.ok) {
      throw new Error(`Could not load ${audioDir + audio_path}: HTTP ${audioResponse.status}`);
    }
    const buf = await audioCtx.decodeAudioData(await audioResponse.arrayBuffer());
    if (requestId !== sceneLoadRequestId) return;

    // Resolve asynchronous assets before creating a playing audio graph.
    const sourceColor = sourceColorForIndex(sourceIndex);
    const { points: src_xyzs, color: pointColor } = await loadPlyAsPoints(
      groundingDir + pcd,
      { color: sourceColor }
    );
    if (requestId !== sceneLoadRequestId) {
      src_xyzs.geometry.dispose();
      src_xyzs.material.dispose();
      return;
    }

    const srcNode     = audioCtx.createBufferSource();
    const loopBus     = audioCtx.createGain();
    const grainBus    = audioCtx.createGain();
    const gain        = audioCtx.createGain();
    const stereoPan   = audioCtx.createStereoPanner();

    srcNode.buffer = buf;
    srcNode.loop   = true;
    loopBus.gain.value = 0; // Unmute only after the entire scene has loaded.
    grainBus.gain.value = 0;
    srcNode.connect(loopBus);
    loopBus.connect(gain);
    grainBus.connect(gain);

    // Create HRIR convolution nodes if available
    let hrirConvolvers = null;
    let foaGains = null;
    let binauralMerger = null;
    let hrirAuxNodes = [];

    if (useHRIR && hrirBuffers) {
      // Create FOA channel gains (W, X, Y, Z)
      foaGains = {
        W: audioCtx.createGain(),
        X: audioCtx.createGain(),
        Y: audioCtx.createGain(),
        Z: audioCtx.createGain()
      };

      // Create convolver nodes for each FOA channel
      hrirConvolvers = {
        W: audioCtx.createConvolver(),
        X: audioCtx.createConvolver(),
        Y: audioCtx.createConvolver(),
        Z: audioCtx.createConvolver()
      };

      // Set HRIR impulse responses
      hrirConvolvers.W.buffer = hrirBuffers.W;
      hrirConvolvers.X.buffer = hrirBuffers.X;
      hrirConvolvers.Y.buffer = hrirBuffers.Y;
      hrirConvolvers.Z.buffer = hrirBuffers.Z;

      // Create merger node to combine binaural outputs (2 channels)
      binauralMerger = audioCtx.createChannelMerger(2);

      // Audio graph for HRIR rendering:
      // loop/grain buses -> gain -> split to 4 FOA channels ->
      // each FOA gain -> convolver -> merge to stereo -> destination

      // Connect the shared spatial gain to each FOA gain
      gain.connect(foaGains.W);
      gain.connect(foaGains.Y);
      gain.connect(foaGains.X);
      gain.connect(foaGains.Z);

      // Connect each FOA channel through its convolver
      // Each convolver output is stereo, we need to sum them
      const sumL = audioCtx.createGain();
      const sumR = audioCtx.createGain();
      const splitters = {};

      for (const ch of ['W', 'X', 'Y', 'Z']) {
        // Create splitter to separate L/R from convolver output
        splitters[ch] = audioCtx.createChannelSplitter(2);
        foaGains[ch].connect(hrirConvolvers[ch]);
        hrirConvolvers[ch].connect(splitters[ch]);

        // Sum left channels
        splitters[ch].connect(sumL, 0);
        // Sum right channels
        splitters[ch].connect(sumR, 1);
      }

      // Merge summed L/R into stereo output
      sumL.connect(binauralMerger, 0, 0);
      sumR.connect(binauralMerger, 0, 1);
      binauralMerger.connect(audioCtx.destination);
      hrirAuxNodes = [sumL, sumR, ...Object.values(splitters)];
    } else {
      // Fallback to stereo panning
      gain.connect(stereoPan).connect(audioCtx.destination);
    }
    srcNode.start();

    const src_sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0xff4444 })
    );
    src_sphere.position.copy(new THREE.Vector3(...centroid));
    src_sphere.visible = false;
    scene.add(src_sphere);

    scene.add(src_xyzs);

    // Create text label with same color as point cloud
    const textLabel = createTextLabel(class_label, pointColor);
    textLabel.position.copy(new THREE.Vector3(...centroid));
    // textLabel.position.z; // Offset slightly above centroid
    textLabel.visible = false; // Initially hidden, shown when centroid or cluster is visible
    scene.add(textLabel);

    const grainPath = typeof grain_path === 'string' && grain_path.trim()
      ? grain_path.trim()
      : null;
    if (grainPath && !isSafeRelativeAssetPath(grainPath)) {
      console.warn(`Ignoring unsafe grain_path for ${class_label}: ${grainPath}`);
    }

    staticSources.push({
      sourceId: `${sourceIndex}:${pcd}`,
      sourceIndex,
      sceneBase: basePath,
      sceneRequestId: requestId,
      classLabel: class_label,
      displayName: `${String(sourceIndex).padStart(2, '0')} · ${class_label} · ${pcd}`,
      pcdFilename: pcd,
      fullPcdUrl: groundingDir + (pcd_points || pcd),
      weightsUrl: pcd_points && pcd_weights
        ? groundingDir + pcd_weights
        : null,
      chartColor: new THREE.Color(pointColor).getStyle(),
      pos: new THREE.Vector3(...centroid),
      srcNode,
      loopBus,
      grainBus,
      gain,
      stereoPan,
      centroid: src_sphere,
      points: src_xyzs,
      label: textLabel,
      disposed: false,
      currentPlaybackRate: 1,
      grainPath: isSafeRelativeAssetPath(grainPath) ? grainPath : null,
      grainState: isSafeRelativeAssetPath(grainPath) ? 'idle' : 'unavailable',
      grainBuffers: [],
      grainLoadedCount: 0,
      grainProcessedCount: 0,
      grainExpectedCount: 0,
      grainLoadFailures: 0,
      grainError: '',
      grainLoadRevision: 0,
      grainLoadPromise: null,
      grainLoadAbortController: null,
      grainLoadingKey: null,
      grainProcessingKey: null,
      grainProcessingSettings: null,
      grainProcessingStage: '',
      grainRootUrl: null,
      grainRateHz: null,
      grainRateWasClamped: false,
      grainMeanDurationSec: null,
      grainOverlapGain: 1,
      grainReferenceRmsDbfs: null,
      grainEldProfile: null,
      grainEldLastUpdateMs: -Infinity,
      nextGrainTime: null,
      activeGrains: new Set(),
      // HRIR-specific nodes
      foaGains,
      hrirConvolvers,
      binauralMerger,
      hrirAuxNodes,
    });
  }
  isSingleSource = (staticSources.length === 1);
  updateStaticSources();
  staticSources.forEach(source => { source.loopBus.gain.value = 1; });
  resetVisualizationState();
  rebuildEldSourceList();
  updateGrainRenderingUi();
}

function setupAudioGraph() {
  stereoPanner = audioCtx.createStereoPanner();
  srcNode.connect(gainNode).connect(stereoPanner).connect(audioCtx.destination);
}

// Compute FOA encoding coefficients for a point source
// Returns {W, X, Y, Z} gains for First-Order Ambisonics
function computeFOAEncoding(sourcePos, listenerPos, listenerQuaternion) {
  // Get direction vector from listener to source in world space
  const rel = new THREE.Vector3().subVectors(sourcePos, listenerPos);
  const distance = rel.length();
  const direction = rel.normalize();

  // Transform direction to listener's local coordinate frame
  const localDir = direction.clone().applyQuaternion(listenerQuaternion.clone().invert());

  // Normalize to unit vector
  const x = localDir.x;
  const y = localDir.y;
  const z = localDir.z;

  // FOA encoding for a point source (N3D normalization)
  // W = omnidirectional component (0th order)
  // X, Y, Z = directional components (1st order)
  const sqrt2 = Math.sqrt(2);

  return {
    W: 1 / sqrt2,        // W channel (omnidirectional)
    X: x,                // X channel (left-right)
    Y: y,                // Y channel (front-back)
    Z: z,                // Z channel (up-down)
    distance: distance
  };
}

function pointSourceRender(s, camera) {
  const rel = new THREE.Vector3().subVectors(s.pos, camera.position);
  const d   = rel.length();
  const u   = rel.normalize();

  const vRel = velocity.dot(u);
  const att  = 1 / Math.max(d, 1);

  // Calculate Doppler effect with bounds checking
  const denominator = c - vRel;
  let playbackRate = 1.0;
  if (Math.abs(denominator) > 0.01) { // Prevent division by very small numbers
    playbackRate = c / denominator;
    // Clamp to reasonable range (0.25x to 4x speed)
    playbackRate = Math.max(0.25, Math.min(4.0, playbackRate));
  }

  s.currentPlaybackRate = playbackRate;
  s.srcNode.playbackRate.value = playbackRate;

  if (useHRIR && s.foaGains) {
    // Use HRIR-based rendering with FOA encoding
    const foa = computeFOAEncoding(s.pos, camera.position, camera.quaternion);
    s.gain.gain.value = att;
    s.foaGains.W.gain.value = foa.W;
    s.foaGains.X.gain.value = foa.X;
    s.foaGains.Y.gain.value = foa.Y;
    s.foaGains.Z.gain.value = foa.Z;
  } else {
    // Fallback to stereo panning
    s.gain.gain.value = att;
    const relLocal = u.clone().applyQuaternion(camera.quaternion.clone().invert());
    s.stereoPan.pan.value = relLocal.x;
  }
}

function computeStereoTHREE(camera, geometry) {
  const posAttr = geometry.attributes.position;
  const array = posAttr.array;
  const N = array.length / 3;
  const eps = 1e-6;

  const tempV = new THREE.Vector3();

  let sumW = 0;
  let sumX = 0;

  for (let i = 0; i < N; i++) {
    tempV.fromArray(array, i * 3).clone();
    tempV.sub(camera.position);
    tempV.applyQuaternion(camera.quaternion.clone().invert());

    const d = tempV.length();
    const invD = 1.0 / Math.max(d, 1e-5);
    const ux = tempV.x * invD;

    const attn = invD;

    sumW += attn;
    sumX += ux * attn;
  }

  const wMean = sumW / N;
  const xMean = sumX / N;

  const pan = Math.max(-1, Math.min(1, xMean / (wMean + eps)));
  return { gain: wMean, pan };
}

// Compute FOA encoding for a cluster/volume of points
function computeFOACluster(camera, geometry) {
  const posAttr = geometry.attributes.position;
  const array = posAttr.array;
  const N = array.length / 3;
  const eps = 1e-6;

  const tempV = new THREE.Vector3();

  let sumW = 0, sumWx = 0, sumWy = 0, sumWz = 0;
  let totalAttn = 0;

  for (let i = 0; i < N; i++) {
    tempV.fromArray(array, i * 3);
    const foa = computeFOAEncoding(tempV, camera.position, camera.quaternion);
    const d = foa.distance;
    const attn = 1.0 / Math.max(d, 1.0);

    sumW += foa.W * attn;
    sumWx += foa.X * attn;
    sumWy += foa.Y * attn;
    sumWz += foa.Z * attn;
    totalAttn += attn;
  }

  const avgAttn = totalAttn / N;

  return {
    W: sumW / N,
    X: sumWx / N,
    Y: sumWy / N,
    Z: sumWz / N,
    gain: avgAttn
  };
}

function clusterSourceRender(s, camera) {
  const rel = new THREE.Vector3().subVectors(s.pos, camera.position);
  const u   = rel.normalize();

  const vRel = velocity.dot(u);

  // Calculate Doppler effect with bounds checking
  const denominator = c - vRel;
  let playbackRate = 1.0;
  if (Math.abs(denominator) > 0.01) { // Prevent division by very small numbers
    playbackRate = c / denominator;
    // Clamp to reasonable range (0.25x to 4x speed)
    playbackRate = Math.max(0.25, Math.min(4.0, playbackRate));
  }

  s.currentPlaybackRate = playbackRate;
  s.srcNode.playbackRate.value = playbackRate;

  if (useHRIR && s.foaGains) {
    // Use HRIR-based rendering with FOA cluster encoding
    const foa = computeFOACluster(camera, s.points.geometry);
    s.gain.gain.value = foa.gain;
    s.foaGains.W.gain.value = foa.W;
    s.foaGains.X.gain.value = foa.X;
    s.foaGains.Y.gain.value = foa.Y;
    s.foaGains.Z.gain.value = foa.Z;
  } else {
    // Fallback to stereo panning
    const result = computeStereoTHREE(camera, s.points.geometry);
    s.gain.gain.value = result.gain;
    s.stereoPan.pan.value = result.pan;
  }
}

function updateStaticSources() {
  let totalLeftVolume = 0;
  let totalRightVolume = 0;

  for (const s of staticSources) {
    if (s.disposed) continue;
    if (!volumeAudio) {
      pointSourceRender(s, camera);
    } else {
      clusterSourceRender(s, camera);
    }

    // Calculate left/right volumes based on pan and gain
    const gain = s.gain.gain.value;
    const pan = s.stereoPan.pan.value; // -1 (left) to 1 (right)

    // Convert pan to left/right gains using equal power panning
    const leftGain = gain * Math.cos((pan + 1) * Math.PI / 4);
    const rightGain = gain * Math.sin((pan + 1) * Math.PI / 4);

    totalLeftVolume += leftGain;
    totalRightVolume += rightGain;
  }

  // Update volume bars (normalize and clamp to 0-100%)
  const maxVolume = 5; // Adjust this to change sensitivity
  const leftPercent = Math.min(100, (totalLeftVolume / maxVolume) * 100);
  const rightPercent = Math.min(100, (totalRightVolume / maxVolume) * 100);

  const leftVolumeEl = document.getElementById('leftVolume');
  const rightVolumeEl = document.getElementById('rightVolume');

  if (leftVolumeEl) leftVolumeEl.style.width = leftPercent + '%';
  if (rightVolumeEl) rightVolumeEl.style.width = rightPercent + '%';
}

const renderWidth = innerWidth;
const renderHeight = innerHeight;
const clock = new THREE.Clock();

let hasScene = false;
let sceneLoadRequestId = 0;
let isSceneLoading = false;

const rootElement = document.createElement('div');
rootElement.style.width = renderWidth + 'px';
rootElement.style.height = renderHeight + 'px';
document.body.appendChild(rootElement);

const renderer = new THREE.WebGLRenderer({
  antialias: false
});
renderer.setSize(renderWidth, renderHeight);
rootElement.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(renderWidth, renderHeight);
labelRenderer.domElement.id = 'labelRendererLayer';
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.left = '0';
labelRenderer.domElement.style.width = '100%';
labelRenderer.domElement.style.height = '100%';
labelRenderer.domElement.style.pointerEvents = 'none';
labelRenderer.domElement.style.overflow = 'hidden';
labelRenderer.domElement.style.zIndex = '5';
rootElement.appendChild(labelRenderer.domElement);

updateLabelRendererClip();

const camera = new THREE.PerspectiveCamera(65, renderWidth / renderHeight, 0.1, 500);
camera.position.copy(new THREE.Vector3().fromArray([0, 0, 0]));
camera.up = new THREE.Vector3().fromArray([0, 0, 1]).normalize();

const viewer = new GaussianSplats3D.Viewer({
  'threeScene': scene,
  'selfDrivenMode': false,
  'renderer': renderer,
  'camera': camera,
  'useBuiltInControls': false,
  'ignoreDevicePixelRatio': false,
  'gpuAcceleratedSort': false,
  'enableSIMDInSort': false,
  'sharedMemoryForWorkers': false,
  'integerBasedSort': true,
  'halfPrecisionCovariancesOnGPU': true,
  'dynamicScene': false,
  'webXRMode': GaussianSplats3D.WebXRMode.None,
  'renderMode': GaussianSplats3D.RenderMode.OnChange,
  'sceneRevealMode': GaussianSplats3D.SceneRevealMode.Instant,
  'antialiased': false,
  'focalAdjustment': 1.0,
  'logLevel': GaussianSplats3D.LogLevel.None,
  'sphericalHarmonicsDegree': 0,
  'enableOptionalEffects': false,
  'inMemoryCompressionLevel': 2,
  'freeIntermediateSplatData': true
});


function onWindowResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  rootElement.style.width = w + 'px';
  rootElement.style.height = h + 'px';
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  updateLabelRendererClip();
}
window.addEventListener('resize', onWindowResize);

const prevPos = camera.position.clone();
const velocity = new THREE.Vector3();

// Minimap setup - use separate container and canvas for rendering
const minimapContainer = document.getElementById('minimapContainer');
const minimapCanvas2D = document.getElementById('minimapCanvas2D');
const minimapCtx = minimapCanvas2D.getContext('2d');
const minimapScale = 10; // Scale factor for the minimap (higher = more zoomed in)
const minimapRange = 20; // Range in world units to display

// Create orthogonal camera for minimap rendering
const minimapSize = 20; // World units to show
// const minimapOrthoCamera = new THREE.OrthographicCamera(
//   -minimapSize / 2, minimapSize / 2,
//   minimapSize / 2, -minimapSize / 2,
//   1, 2000
// );
const minimapOrthoCamera = new THREE.PerspectiveCamera(90, 1, 4, 500);
minimapOrthoCamera.up.set(0, 0, -1); // Set Z as down for top-down view

// Create minimap viewer with Gaussian renderer
const minimapViewer = new GaussianSplats3D.Viewer({
  'cameraUp': [0, 0, -1],
  'initialCameraPosition': [0, 2, 0],
  'initialCameraLookAt': [0, 0, 0],
  'selfDrivenMode': false,
  'camera': minimapOrthoCamera,
  'useBuiltInControls': false,
  'ignoreDevicePixelRatio': true,
  'gpuAcceleratedSort': false,
  'enableSIMDInSort': false,
  'sharedMemoryForWorkers': false,
  'integerBasedSort': true,
  'halfPrecisionCovariancesOnGPU': false,
  'dynamicScene': false,
  'webXRMode': GaussianSplats3D.WebXRMode.None,
  'renderMode': GaussianSplats3D.RenderMode.Always,
  'sceneRevealMode': GaussianSplats3D.SceneRevealMode.Instant,
  'antialiased': false,
  // 'focalAdjustment': 1.0,
  'logLevel': GaussianSplats3D.LogLevel.None,
  'sphericalHarmonicsDegree': 0,
  'enableOptionalEffects': false,
  'inMemoryCompressionLevel': 2,
  'freeIntermediateSplatData': false,
  'rootElement': minimapContainer
});

minimapViewer.init();

// Track if minimap scene is loaded
let minimapSceneLoaded = false;
let hasStartedUpdateLoop = false;

let lastSourceCount = 0;

function drawMinimap() {
  // Position orthogonal camera above the main camera
  const cameraHeight = 4; // Height above main camera
  minimapOrthoCamera.position.set(
    camera.position.x,
    camera.position.y + cameraHeight, // Look from above
    camera.position.z
  );
  // minimapOrthoCamera.lookAt(0, -1, 0);
  minimapOrthoCamera.lookAt(
    camera.position.x,
    camera.position.y,
    camera.position.z
  );

  // Adjust near/far planes to show content below main camera's height
  // The ortho camera is at (camera.y + 20), looking down
  // To show content below the main camera (camera.y), we need:
  // - near plane at distance cameraHeight (which is at main camera.y level)
  // - far plane much further down to capture everything below
  // minimapOrthoCamera.near = 0.1; // Start at main camera level
  // minimapOrthoCamera.far = 500; // Extend far down
  // minimapOrthoCamera.updateProjectionMatrix();

  // Update and render the Gaussian splats minimap
  minimapViewer.update();
  minimapViewer.render();

  // Now draw 2D overlay elements on top
  const ctx = minimapCtx;
  const width = minimapCanvas2D.width;
  const height = minimapCanvas2D.height;
  const centerX = width / 2;
  const centerY = height / 2;

  // Clear the 2D canvas before drawing
  ctx.clearRect(0, 0, width, height);

  // Get camera direction in XZ plane
  const cameraDir = new THREE.Vector3();
  camera.getWorldDirection(cameraDir);

  // Draw camera position (center of minimap)
  ctx.fillStyle = 'rgba(255, 215, 0, 1)'; // Bright gold color for visibility
  ctx.beginPath();
  ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
  ctx.fill();
  // Add a border for extra visibility
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw camera direction indicator (arrow)
  const arrowLength = 20;
  const arrowAngle = Math.atan2(cameraDir.x, cameraDir.z);
  const arrowEndX = centerX + Math.sin(arrowAngle) * arrowLength;
  const arrowEndY = centerY + Math.cos(arrowAngle) * arrowLength;

  // Draw main direction line
  ctx.strokeStyle = 'rgba(255, 215, 0, 1)'; // Gold color to match center
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(arrowEndX, arrowEndY);
  ctx.stroke();

  // Draw arrowhead
  const arrowHeadSize = 7;
  const angle1 = arrowAngle + Math.PI * 0.75;
  const angle2 = arrowAngle - Math.PI * 0.75;

  ctx.fillStyle = 'rgba(255, 215, 0, 1)'; // Gold color to match center
  ctx.beginPath();
  ctx.moveTo(arrowEndX, arrowEndY);
  ctx.lineTo(arrowEndX + Math.sin(angle1) * arrowHeadSize, arrowEndY + Math.cos(angle1) * arrowHeadSize);
  ctx.lineTo(arrowEndX + Math.sin(angle2) * arrowHeadSize, arrowEndY + Math.cos(angle2) * arrowHeadSize);
  ctx.closePath();
  ctx.fill();

  // Draw field of view cone
  const fov = camera.fov * (Math.PI / 180);
  const fovLength = 30;
  const leftAngle = arrowAngle + fov / 2;
  const rightAngle = arrowAngle - fov / 2;

  // Calculate the endpoints of the FOV cone
  const leftX = centerX + Math.sin(leftAngle) * fovLength;
  const leftY = centerY + Math.cos(leftAngle) * fovLength;
  const rightX = centerX + Math.sin(rightAngle) * fovLength;
  const rightY = centerY + Math.cos(rightAngle) * fovLength;

  ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)'; // Gold with medium opacity
  ctx.fillStyle = 'rgba(255, 215, 0, 0.15)'; // Gold with low opacity for fill
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(leftX, leftY);
  // Draw arc from left to right angle
  // Convert our angle system to canvas arc system: subtract PI/2 to align
  ctx.arc(centerX, centerY, fovLength, -leftAngle + Math.PI / 2, -rightAngle + Math.PI / 2, false);
  ctx.lineTo(centerX, centerY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Draw coordinates
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  const coordText = `X: ${camera.position.x.toFixed(1)} Z: ${camera.position.z.toFixed(1)}`;
  ctx.fillText(coordText, 5, height - 5);
}

function update() {
  const cbStart = performance.now(); // ==== NEW: callback 计时开始 ====

  requestAnimationFrame(update);

  const dt = Math.min(clock.getDelta(), 0.05);
  const speed = 0.5;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.y = 0; dir.normalize();
  const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  camera.position.addScaledVector(dir, speed * (move.forward - move.back) * dt);
  camera.position.addScaledVector(right, speed * (move.right - move.left) * dt);
  camera.position.y += speed * (move.up - move.down) * dt;

  if (dt > 1e-6) {
    velocity.subVectors(camera.position, prevPos).divideScalar(dt);
  } else {
    velocity.set(0, 0, 0);
  }

  if (!isSceneLoading && staticSources.length > 0) {
    updateStaticSources();
  }
  updateEldInspector(cbStart);
  prevPos.copy(camera.position);

  if (hasScene) {
    viewer.update();
    viewer.render();
    labelRenderer.render(scene, camera);
  }

  if (minimapSceneLoaded) {
    drawMinimap();
  } else {
    minimapCtx.clearRect(0, 0, minimapCanvas2D.width, minimapCanvas2D.height);
  }

  const cbEnd = performance.now();   // ==== NEW: callback 计时结束 ====
  const cbDur = cbEnd - cbStart;    // 本帧 update 执行耗时 (ms)
  cbAvgMs = cbAvgMs ? (1 - cbSmooth) * cbAvgMs + cbSmooth * cbDur : cbDur;

  if (cbLastEl) cbLastEl.textContent = cbDur.toFixed(3);
  if (cbAvgEl)  cbAvgEl.textContent  = cbAvgMs.toFixed(3);
}

let yaw = 0, pitch = 0;
const sensitivity = 0.002;
renderer.domElement.addEventListener('click', ()=>renderer.domElement.requestPointerLock());
document.addEventListener('pointerlockchange', ()=>{
  if (document.pointerLockElement === renderer.domElement) {
    document.addEventListener('mousemove', onMouseMove);
  } else {
    document.removeEventListener('mousemove', onMouseMove);
  }
});
function onMouseMove(e) {
  yaw   -= e.movementX * sensitivity;
  pitch -= e.movementY * sensitivity;
  pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, pitch));
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}
const move = { forward: 0, back: 0, left: 0, right: 0, up: 0, down: 0 };
window.addEventListener('keydown', e => {
  if (isUiLocked || e.target.closest('input, select, textarea, [contenteditable="true"]')) return;
  setMove(e.code, 1);
});
window.addEventListener('keyup', e => setMove(e.code, 0));
window.addEventListener('blur', () => {
  Object.keys(move).forEach(key => { move[key] = 0; });
});
function setMove(code, v) {
  switch (code) {
    case 'KeyW': move.forward = v; break;
    case 'KeyS': move.back = v; break;
    case 'KeyA': move.left = v; break;
    case 'KeyD': move.right = v; break;
    case 'KeyI': move.up = v; break;
    case 'KeyK': move.down = v; break;
  }
}

const scenePathInput = document.getElementById('scenePathInput');
const scenePreset = document.getElementById('scenePreset');
const sceneLoadStatus = document.getElementById('sceneLoadStatus');
const loadSceneButton = document.getElementById('loadGaussianScene');

function setSceneLoadStatus(message, state = '') {
  sceneLoadStatus.textContent = message;
  sceneLoadStatus.dataset.state = state;
  sceneLoadStatus.setAttribute('aria-busy', String(state === 'loading'));
}

scenePreset.addEventListener('change', () => {
  if (scenePreset.value) scenePathInput.value = scenePreset.value;
  else scenePathInput.focus();
});
scenePreset.addEventListener('keydown', event => event.stopPropagation());
scenePreset.addEventListener('keyup', event => event.stopPropagation());
scenePathInput.addEventListener('input', () => {
  const path = scenePathInput.value.trim().replace(/\/+$/, '');
  scenePreset.value = [...scenePreset.options].some(option => option.value === path)
    ? path : '';
});

scenePathInput.addEventListener('keydown', event => {
  event.stopPropagation();

  if (event.key === 'Enter') {
    event.preventDefault();
    loadSceneButton.click();
  }
});
scenePathInput.addEventListener('keyup', event => event.stopPropagation());

loadSceneButton.addEventListener('click', async function () {
  if (isSceneLoading) return;

  const sceneBase = scenePathInput.value.trim().replace(/\/+$/, '');
  if (!sceneBase) {
    setSceneLoadStatus('Enter a scene path or choose a preset.', 'error');
    scenePathInput.focus();
    return;
  }

  scenePathInput.value = sceneBase;
  isSceneLoading = true;
  const requestId = ++sceneLoadRequestId;
  const selectedScene = sceneBase + '/3d/gaussian.compressed.ply';
  const controlPanel = document.getElementById('controlPanel');

  if (controlPanel) {
    controlPanel.scrollTop = 0;
  }

  try {
    stopCurrentSceneAudio();
    staticSources.forEach(source => disposeStaticSource(source, true));
    staticSources.length = 0;
    updateStaticSources();
    Object.keys(move).forEach(key => { move[key] = 0; });
    setSceneLoadStatus(`Loading ${sceneBase}…`, 'loading');
    setMainLoading(true);
    setMinimapLoading(true);
    resetEldInspector('Loading scene sources…');

    await clearMinimapScene();
    if (requestId !== sceneLoadRequestId) return;

    resetVisualizationState();

    camera.position.set(0, 0, 0);
    yaw = 0;
    pitch = 0;
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
    prevPos.copy(camera.position);

    if (viewer.getSceneCount() > 0) {
      hasScene = false;
      await viewer.removeSplatScene(0);
      if (requestId !== sceneLoadRequestId) return;
      console.log('Scene removed successfully');
    }

    // The library's wrapper is not a Promise-compatible thenable on failure.
    await viewer.addSplatScene(
      selectedScene,
      {
        splatAlphaRemovalThreshold: 5,
        showLoadingUI: true,
        position: [0, 0, 0],
        rotation: [1, 0, 0, 0],
        scale: [1.0, 1.0, 1.0],
        progressiveLoad: false,
      },
    ).promise;

    if (requestId !== sceneLoadRequestId) return;

    hasScene = true;

    if (!hasStartedUpdateLoop) {
      hasStartedUpdateLoop = true;
      requestAnimationFrame(update);
    }

    await loadStaticSourceList(sceneBase, requestId);
    if (requestId !== sceneLoadRequestId) return;

    scheduleMinimapLoad(selectedScene, 0);

    const sourceCount = staticSources.length;
    setSceneLoadStatus(
      `Loaded ${sceneBase} · ${sourceCount} source${sourceCount === 1 ? '' : 's'}.`,
      'ready'
    );
  } catch (err) {
    if (requestId === sceneLoadRequestId) {
      stopCurrentSceneAudio();
      staticSources.forEach(source => disposeStaticSource(source, true));
      staticSources.length = 0;
      isSingleSource = false;
      resetEldInspector('Scene loading failed. Choose a scene and retry.');
      hasScene = false;
      setMinimapLoading(false);
      // Also remove a successfully loaded splat if a later source asset failed.
      if (viewer.getSceneCount() > 0) {
        try { await viewer.removeSplatScene(0); }
        catch (cleanupError) { console.warn('Scene cleanup failed:', cleanupError); }
      }
      renderer.clear();
      labelRenderer.render(scene, camera);
      setSceneLoadStatus(`Load failed: ${err.message || err}. Choose a scene and retry.`, 'error');
    }
    console.error('Failed to load scene:', err);
  } finally {
    if (requestId === sceneLoadRequestId) {
      isSceneLoading = false;
      setMainLoading(false);
      updatePlayButton();
    }
  }
});

const playBtn = document.getElementById('togglePlay');

function updatePlayButton() {
  if (!audioCtx || !staticSources.some(source => !source.disposed)) {
    playBtn.disabled = true;
    playBtn.textContent = 'Play';
    return;
  }
  playBtn.disabled = false;
  playBtn.textContent = (audioCtx.state === 'running') ? 'Pause' : 'Play';
}

async function toggleAudioPlay() {
  if (!audioCtx) return;
  if (audioCtx.state === 'running') {
    await audioCtx.suspend();
  } else {
    await audioCtx.resume();
  }
  updatePlayButton();
}

playBtn.addEventListener('click', () => {
  if (isUiLocked) return;
  toggleAudioPlay();
});

window.addEventListener('keydown', (e) => {
  if (isUiLocked || e.target.closest('input, select, textarea, button, [contenteditable="true"]')) return;

  if (e.code === 'Space') {
    e.preventDefault();
    toggleAudioPlay();
  }
});

// Collapsible panel sections
document.querySelectorAll('.panel-title[data-target]').forEach(title => {
  title.addEventListener('click', () => {
    if (isUiLocked) return;

    const body = document.getElementById(title.dataset.target);
    const isCollapsed = body.classList.toggle('collapsed');
    title.classList.toggle('collapsed', isCollapsed);
  });
});

// Left panel collapse/expand
const controlPanel = document.getElementById('controlPanel');
const toggleBtn = document.getElementById('panelToggleBtn');
controlPanel.addEventListener('wheel', (e) => {
  if (isUiLocked) {
    e.preventDefault();
    e.stopPropagation();
  }
}, { passive: false });
toggleBtn.addEventListener('click', () => {
  if (isUiLocked) return;

  controlPanel.classList.toggle('panel-collapsed');
  updateLabelRendererClip();
});
