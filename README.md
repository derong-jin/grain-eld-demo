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
| Spring | 14 | Original looping audio for waterfalls, streams, trees and flowers |

Spring1 is selected initially. Choose a preset and click **Load Scene**. **Scene Path** remains editable for compatible scene folders served from this repository. Changing the selection alone does not load a scene.

The audio renderer uses stereo panning; no HRIR downloads are needed. Spring has no grain dictionaries, so its grain controls remain unavailable. Switching scenes stops the old loops, grain events and grain-loading work. If loading fails, the page displays the error and lets you select a scene and retry.

## Controls

- Click the 3D view to look around with the mouse; press Escape to release it.
- **W/S** move forward/back, **A/D** left/right, **I/K** up/down. **Reset Camera to Origin** returns to the initial view.
- **Play/Pause**, or **Space** outside form fields, controls audio. If your browser suspends audio on startup, click **Play**.
- **Loop Audio** switches Spring1 to **Grain Rendering**. The first switch loads and preprocesses all 183 grains; switching back restores the original loop.
- **Window** selects None, Tukey (with alpha), or Hann. **Denoise** selects None or Spectral, with strength and attenuation controls. Changes reload/preprocess grains while muted and restore the selected content mode when ready.
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

Only files referenced by the two included scenes are bundled: approximately **107.2 MiB** of scene/audio resources, with a largest file of **31.05 MiB**. The Gaussian PLY files are already compressed. Original PCM WAV grains are preserved without recompression, to keep the existing preprocessing and loudness calculations unchanged.

All necessary resources are tracked with ordinary Git; Git LFS is not required. Upload using `git push` (the web upload UI has a smaller per-file limit). Git stores identical file contents once even when shared by the two scene directories. No remote repository is configured by this extraction.

## Validation

```sh
python3 tools/check_assets.py
node --input-type=module --check < demo.js
node --check grain-preprocess-worker.js
```

Node is needed only for these optional JavaScript syntax checks. The asset checker verifies both scenes' runtime references, dictionary counts, directory containment and file-size thresholds. For browser checks: load both scenes; switch loops/grains; change window/denoise; inspect ELD; move/reset the camera; switch scenes repeatedly, including during grain loading; and try a missing custom scene path followed by a valid preset.
