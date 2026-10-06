// Exercise the production grain lifecycle with deterministic fetch/Web Audio doubles.
// Rendering/CDN imports are excluded; all functions under test come directly from demo.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../demo.js', import.meta.url), 'utf8');
const functions = [
  'getGrainCapableSources', 'disconnectAudioNode', 'stopActiveGrains',
  'smoothAudioParam', 'setSourceContentBusGains', 'silenceSourceContentBuses',
  'clearGrainLibraries', 'clearSourceGrainCache', 'disposeStaticSourceAudio',
  'deactivateGrainRendering', 'stopCurrentSceneAudio', 'isSafeRelativeAssetPath',
  'createGrainAbortError', 'assertGrainLibraryCurrent', 'fetchGrainJson',
  'decodeGrainEntry', 'computeAudioBufferRmsDbfs', 'preprocessDecodedGrains',
  'ensureSourceGrains', 'ensureGrainLibrary', 'loadGrainsForContentMode',
  'activateGrainRendering', 'reloadGrainsForProcessing',
  'samplePoissonInterval', 'runGrainSchedulerTick',
];
const declarations = [...source.matchAll(/^(?:async )?function (\w+)\(/gm)];
function productionFunctions(names) {
  return names.map(name => {
    const index = declarations.findIndex(match => match[1] === name);
    assert.notEqual(index, -1, `Missing production function: ${name}`);
    return source.slice(declarations[index].index, source.indexOf('\n}', declarations[index].index) + 2);
  }).join('\n');
}
const code = productionFunctions(functions);

function param() {
  return { value: 0, cancelAndHoldAtTime() {},
    setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; } };
}
function fixture(paths = ['stream', 'stream', null]) {
  const counts = new Map();
  let gate = null;
  let failPath = null;
  let decodes = 0;
  const settings = { key: 'none|none', windowKind: 'none', denoiseKind: 'none' };
  const sources = paths.map((grainPath, id) => ({
    grainPath, displayName: `source ${id}`, sceneBase: 'marble-scenes/spring',
    sceneRequestId: 1, grainLoadRevision: 0, grainState: grainPath ? 'idle' : 'unavailable',
    grainBuffers: [], activeGrains: new Set(), nextGrainTime: null,
    loopBus: { gain: param() }, grainBus: { gain: param() },
    grainEldProfile: { sourceId: id },
  }));
  const context = vm.createContext({
    console: { info() {}, error() {}, warn() {} }, URL, DOMException, AbortController,
    setTimeout, clearTimeout, window: { setTimeout }, document: { baseURI: 'http://localhost:8000/' },
    grainLibraries: new Map(), staticSources: sources, sceneLoadRequestId: 1,
    grainModeGeneration: 0, grainRenderingEnabled: false, grainRequestedContentMode: 'loop',
    GRAIN_LOAD_CONCURRENCY: 6, GRAIN_MAX_RATE_HZ: 100, GRAIN_MODE_FADE_SEC: 0.02,
    getGrainProcessingSettings: () => settings,
    updateGrainRenderingUi() {}, syncEldControlState() {},
    ensureEldPointSamples: async () => {}, startGrainScheduler() {}, stopGrainScheduler() {},
    audioCtx: { currentTime: 0, sampleRate: 44100,
      async decodeAudioData() { decodes++; return { duration: 0.2, numberOfChannels: 1,
        getChannelData: () => new Float32Array([0.1, -0.1, 0.2, -0.2]) }; } },
    fetch: async (url, { signal }) => {
      counts.set(url, (counts.get(url) || 0) + 1);
      if (gate) await new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('cancelled', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        gate.then(() => { signal.removeEventListener('abort', abort); resolve(); });
      });
      if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
      return { ok: !failPath || !url.includes(failPath), status: 404,
        json: async () => url.endsWith('rate.json') ? { poisson_rate: 50 } : {
          format: 'sound-grain-dictionary', version: 1,
          grains: { a: { path: 'grains/a.wav' }, b: { path: 'grains/b.wav' } },
        }, arrayBuffer: async () => new ArrayBuffer(4) };
    },
  });
  vm.runInContext(code, context);
  return { context, sources, counts, settings, decodes: () => decodes,
    hold() { let release; gate = new Promise(resolve => { release = resolve; });
      return () => { release(); gate = null; }; },
    fail(path) { failPath = path; } };
}

test('seven sources share three libraries, with independent ELD and original audio during loading', async () => {
  const f = fixture(['stream', 'stream', 'waterfall', 'leaves', 'leaves', 'leaves', 'leaves', null]);
  const release = f.hold();
  const pending = f.context.activateGrainRendering();
  assert.equal(f.sources.at(-1).loopBus.gain.value, 1);
  assert.equal(f.sources[0].loopBus.gain.value, 0);
  release();
  assert.equal(await pending, true);
  assert.equal(f.context.grainLibraries.size, 3);
  assert.equal(f.decodes(), 6);
  assert.ok([...f.counts.values()].every(count => count === 1));
  assert.equal(f.sources[0].grainBuffers, f.sources[1].grainBuffers);
  assert.equal(f.sources[3].grainBuffers, f.sources[6].grainBuffers);
  assert.notEqual(f.sources[0].grainEldProfile, f.sources[1].grainEldProfile);
  assert.notEqual(f.sources[0].activeGrains, f.sources[1].activeGrains);
  assert.equal(f.sources[0].grainBus.gain.value, 1);
  assert.equal(f.sources.at(-1).loopBus.gain.value, 1);
});

test('returning to loops while grains load cannot be undone by late completion', async () => {
  const f = fixture(); const release = f.hold();
  const pending = f.context.activateGrainRendering();
  f.context.deactivateGrainRendering({ immediate: true });
  release();
  assert.equal(await pending, false);
  assert.equal(f.context.grainRenderingEnabled, false);
  assert.ok(f.sources.every(s => s.loopBus.gain.value === 1 && s.grainBus.gain.value === 0));
  const counts = [...f.counts.values()];
  await f.context.activateGrainRendering();
  assert.deepEqual([...f.counts.values()], counts, 'ready library reused without another fetch');
});

test('scene teardown aborts shared work, clears buffers and prevents stale activation', async () => {
  const f = fixture(); const release = f.hold();
  const pending = f.context.activateGrainRendering();
  f.context.stopCurrentSceneAudio();
  release(); await pending;
  assert.equal(f.context.grainLibraries.size, 0);
  assert.equal(f.context.grainRenderingEnabled, false);
  assert.ok(f.sources.every(s => s.disposed && s.grainBuffers.length === 0));
});

test('missing grain fails its library; loops and retry remain usable without reloading ready libraries', async () => {
  const f = fixture(['stream', 'waterfall', null]); f.fail('waterfall/grains/b.wav');
  assert.equal(await f.context.activateGrainRendering(), false);
  assert.equal(f.sources[0].grainState, 'ready');
  assert.equal(f.sources[1].grainState, 'error');
  assert.match(f.sources[1].grainError, /waterfall/);
  assert.equal(f.sources[2].loopBus.gain.value, 1);
  f.context.deactivateGrainRendering({ immediate: true });
  assert.ok(f.sources.every(s => s.loopBus.gain.value === 1));
  f.fail(null); await f.context.activateGrainRendering();
  assert.equal(f.context.grainRenderingEnabled, true);
  assert.ok([...f.counts].filter(([url]) => url.includes('/stream/')).every(([, n]) => n === 1));
});

test('changing preprocessing replaces shared buffers once while preserving original-source playback', async () => {
  const f = fixture(); await f.context.activateGrainRendering();
  const old = f.sources[0].grainBuffers;
  f.settings.key = 'different-settings';
  const release = f.hold(); const pending = f.context.reloadGrainsForProcessing();
  assert.equal(f.sources[2].loopBus.gain.value, 1);
  release(); await pending;
  assert.notEqual(f.sources[0].grainBuffers, old);
  assert.equal(f.sources[0].grainBuffers, f.sources[1].grainBuffers);
  assert.equal(f.decodes(), 4);
  assert.equal(f.context.grainLibraries.size, 1);
});

test('sources using the same buffers schedule independently and never schedule original-only sources', async () => {
  const f = fixture(); await f.context.activateGrainRendering();
  const scheduled = [[], [], []];
  let seed = 17;
  const randomMath = Object.create(Math);
  randomMath.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  Object.assign(f.context, {
    Math: randomMath, performance: { now: () => 100 },
    GRAIN_SCHEDULER_START_LEAD_SEC: 0.03, GRAIN_SCHEDULER_LOOKAHEAD_SEC: 0.1,
    GRAIN_MAX_EVENTS_PER_TICK: 64, refreshSourceGrainEldProfile() {},
    scheduleGrainEvent: (source, time) => scheduled[f.sources.indexOf(source)].push(time),
  });
  f.context.audioCtx.state = 'running';
  f.context.runGrainSchedulerTick();
  assert.ok(scheduled[0].length > 0 && scheduled[1].length > 0);
  assert.notDeepEqual(scheduled[0], scheduled[1]);
  assert.equal(scheduled[2].length, 0);
  assert.ok(scheduled.flat().every(time => time >= 0.03 && time <= 0.1));
  assert.notEqual(f.sources[0].nextGrainTime, f.sources[1].nextGrainTime);
});

class EldVector {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  fromArray(values, index) { [this.x, this.y, this.z] = values.slice(index, index + 3); return this; }
  distanceTo(other) { return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z); }
}

for (const previousAudio of [false, true]) {
  test(`ELD-only scene loads 14 geometries without audio or source overlays${previousAudio ? ' and closes the previous audio context' : ''}`, async () => {
    const config = JSON.parse(readFileSync(new URL('../marble-scenes/spring/render_cfg/choice.json', import.meta.url)));
    const requests = [];
    const windowStates = [];
    let closed = false;
    const context = vm.createContext({
      staticSources: [], sceneLoadRequestId: 1, isSingleSource: false,
      audioCtx: previousAudio ? { async close() { closed = true; } } : null,
      window: { AudioContext() { assert.fail('ELD-only scene must not create an AudioContext'); } },
      THREE: { Vector3: EldVector, Color: class { getStyle() { return '#123456'; } } },
      document: { getElementById: () => null },
      resetEldInspector() {}, updateGrainRenderingUi() {}, updateAudioMetrics() {},
      resetVisualizationState() {}, rebuildEldSourceList() {}, syncScenePresentation() {},
      sourceColorForIndex: () => 0, setEldWindowOpen: value => windowStates.push(value),
      setSourceContentBusGains() { assert.fail('ELD data must not enter audio rendering'); },
      fetch: async url => {
        requests.push(url);
        assert.ok(url.endsWith('/render_cfg/choice.json'), 'only ELD config is fetched by the source loader');
        return { ok: true, json: async () => config };
      },
    });
    vm.runInContext(productionFunctions(['loadStaticSourceList', 'updateStaticSources']), context);
    await context.loadStaticSourceList('marble-scenes/spring', 1);
    assert.equal(context.staticSources.length, 14);
    assert.equal(requests.length, 1);
    assert.equal(context.audioCtx, null);
    assert.equal(closed, previousAudio);
    assert.deepEqual(windowStates, [true]);
    for (const [index, record] of context.staticSources.entries()) {
      assert.equal(record.fullPcdUrl, `marble-scenes/spring/render_cfg/${config[index].pcd_points}`);
      assert.equal(record.weightsUrl, `marble-scenes/spring/render_cfg/${config[index].pcd_weights}`);
      assert.ok(!record.srcNode && !record.grainPath && !record.points && !record.centroid && !record.label);
    }
  });
}

test('ELD density uses weighted scene coordinates without a Three.js render object', () => {
  const context = vm.createContext({
    THREE: { Vector3: EldVector }, ELD_MIN_DISTANCE: 1, ELD_REFERENCE_DISTANCE: 1,
  });
  vm.runInContext(productionFunctions(['computeSourceLoudnessProfile']), context);
  const profile = context.computeSourceLoudnessProfile({
    eldSamples: { positions: new Float32Array([0, 0, 1, 0, 0, 10]), weights: new Float32Array([0.25, 0.75]) },
  }, new EldVector());
  assert.deepEqual(Array.from(profile.loudnesses), [-0, -20]);
  assert.equal(profile.mean, -15);
  assert.equal(profile.variance, 75);
  assert.equal(profile.weightTotal, 1);
});
