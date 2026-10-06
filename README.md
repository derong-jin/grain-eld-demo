# Sound Grain Viewer

A standalone interactive viewer for Gaussian-splat scenes and spatial sound grains, extracted from the sound grain research project. The included scenes and audio live entirely inside this repository.

## Run locally

Requires Python 3 and a desktop browser with WebGL2 and Web Audio support. No Python packages or Node build step are needed.

```sh
python3 cors_server.py 8000
```

Open **http://localhost:8000/**. The port is optional (default: 8000); choose another port if it is occupied. The server binds to localhost and serves this repository even when launched from another working directory. It sends the viewer's COOP/COEP headers. Open through the server, rather than double-clicking the HTML file.

Internet access is required for the existing pinned CDN imports: **Three.js 0.165.0** (unpkg) and **GaussianSplats3D 0.4.7** (jsDelivr). The Inter font also loads from Google Fonts, with a system-font fallback. Scene and audio assets are served locally.

## Included scenes

| Preset | Sources | Content |
| --- | ---: | --- |
| Spring1 · Sound Grains | 1 stream | Original loop and 183 sound grains from NHU05104248, at 50 events/s |
| Spring · Sound Grains | 14 | 7 grain sources using 231 unique grains in 3 libraries; 5 bird and 2 insect sources retain original loops |

Spring1 is selected initially. Choose a preset and click **Load Scene**. Grain-capable scenes automatically load their grains and start in **Grain Rendering**, with **KDE at 0.1 dB bandwidth** as the initial ELD representation. **Scene Path** remains editable for compatible scene folders served from this repository. Changing the selection alone does not load a scene.

The audio renderer uses stereo panning; no HRIR downloads are needed. Switching scenes stops the old loops, grain events and grain-loading work. If loading fails, the page displays the error and lets you select a scene and retry.

## Spring audio libraries

Spring uses `NHU05104248` for both streams, `waterfall-348818` for its waterfall, and `leaves-390849` for the four `2_tree_*` wind sources. Each grain source uses 50 events/s. Sources sharing a library share decoded/processed buffers, while scheduling, ELD, gain and panning remain independent. Scene changes discard the cache and abort pending work.

The new recordings are CC0 clips from FSD50K. See [audio sources and processing](AUDIO_SOURCES.md) and [machine-readable provenance](audio-sources.json) for authors, hashes, level adjustment and segmentation. Leaf spectral denoising uses a quiet-frame estimate because the recording has no usable silent gaps; it may remove some leaf texture. Denoising is optional and defaults to **None**.

## Controls

- Click the 3D view to look around with the mouse; press Escape to release it.
- **W/S** move forward/back, **A/D** left/right, **I/K** up/down. **Reset Camera to Origin** returns to the initial view.
- **Play/Pause**, or **Space** outside form fields, controls audio. If your browser suspends audio on startup, click **Play**.
- **Current mode** shows whether the scene uses Grain Rendering or Loop Rendering. **Switch to Loop Rendering** repeats the original recording; **Switch to Grain Rendering** returns to grain synthesis. Grain-capable sources automatically load and preprocess their grains after the scene loads. In Spring, the waterfall, two streams and four wind-in-tree sources switch to grains; the five birds and two insects continue using their original recordings. The original loops remain available unchanged for comparison.
- **Window** selects None, Tukey (with alpha), or Hann. **Denoise** selects None or Spectral, with strength and attenuation controls. Changes reload/preprocess each shared library once. Only sources awaiting grain playback are muted; birds and insects continue playing. You can switch to Loop even during preparation or failure. A failed library is named in the status message; **Retry Grain Load** retries it without reloading ready libraries.
- **Volume Audio / Point Audio** switches the spatial rendering method. Centroid/cluster toggles show source positions and point clouds; the overview shows the scene and listener.
- **Open ELD Inspector** shows the source loudness distribution. Histogram, Gaussian and KDE derive from weighted source point clouds. Dummy Gaussian is available for Spring1's single grain-capable source. See [the ELD model](ELD_POINT_CLOUD_MODEL.md) for the model and its limitations.

## Scene format

The viewer preserves the existing scene layout:

```text
marble-scenes/<scene>/
  3d/gaussian.compressed.ply
  render_cfg/choice.json
  render_cfg/*.ply, *_weights.npy
  audio/*.wav
  sound-grains/<dictionary>/       # only for grain-capable sources
    dictionary.json
    rate.json
    noise-profile.json
    grains/*.wav
```

Each source in `choice.json` references its loop (`audio_path`) and source cloud (`pcd`), with `pcd_points` and `pcd_weights` for ELD. An optional `grain_path` resolves under that scene's `sound-grains/` directory. The browser consumes a `sound-grain-dictionary` version 1 JSON dictionary and a rate file containing `poisson_rate`. Spectral denoising uses the dictionary's relative `noise_profile.path`.

Dictionary provenance may name the original recording or offline outputs. Those fields are retained as metadata; the viewer does not fetch the source recording, snapshots, pickle dictionaries, or generation scripts. Offline generation remains in the parent research project.

## Assets and Git

Only files referenced by the two included scenes are bundled: approximately **135.8 MiB** of scene/audio resources, with a largest file of **31.05 MiB**. The Gaussian PLY files are already compressed. Original PCM WAV grains are preserved without recompression, to keep the existing preprocessing and loudness calculations unchanged.

All necessary resources are tracked with ordinary Git; Git LFS is not required. Upload using `git push` (the web upload UI has a smaller per-file limit). Git stores identical file contents once even when shared by the two scene directories. No remote repository is configured by this extraction.

## Validation

```sh
python3 tools/check_assets.py
node --input-type=module --check < demo.js
node --check grain-preprocess-worker.js
node --test tools/test_grain_runtime.mjs
```

Node is needed only for these optional JavaScript checks. The asset checker verifies runtime references, source assignments, PCM grain formats, noise spectra, unique dictionary counts, the byte-identical Spring1 stream copy, directory containment and file-size thresholds. Lifecycle tests cover shared libraries, independent scheduling, mixed playback during loading, cancellation, loop fallback, missing-grain retry and preprocessing changes. For browser checks: load both scenes; switch loops/grains; change window/denoise; inspect ELD; move/reset the camera; switch scenes repeatedly, including during grain loading; and try a missing custom scene path followed by a valid preset.

Browser verification on 2026-10-06 loaded all three Spring libraries and both scenes. A temporary Web Audio probe counted **245 decoded buffers** for Spring (231 grains + 14 original loops), **7 audible loops** in Grain mode, and **14 audible loops with zero active grains** in Loop mode. During grain preprocessing and a deliberately missing waterfall library, the seven original-only loops remained audible. Restoring the resource and retrying decoded only the missing 36 waterfall grains. Scene switching during preprocessing, pause/resume, window/denoise controls, camera movement, the minimap and KDE 0.1 inspector were exercised. Sampled output windows showed no clipping during the tested paths; this is not an exhaustive guarantee for every camera position and parameter setting. Temporary probe files and failure fixtures were removed.
