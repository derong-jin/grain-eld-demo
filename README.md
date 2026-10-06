# Sound Grain Viewer

A standalone interactive viewer for Gaussian-splat scenes, spatial sound grains and event loudness density (ELD). All runtime scene and audio assets live inside this repository.

## Run locally

Requires Python 3 and a desktop browser with WebGL2 and Web Audio support. No Python packages or Node build step are needed.

```sh
python3 cors_server.py 8000
```

Open **http://localhost:8000/**. The port is optional (default: 8000). The server binds to localhost and serves this repository even when launched from another working directory, with COOP/COEP headers for local development. The renderer disables shared-memory workers, so static hosting without these headers is also supported. Use the server rather than opening the HTML file directly.

Internet access is required for the pinned CDN imports: **Three.js 0.165.0** (unpkg) and **GaussianSplats3D 0.4.7** (jsDelivr). Inter loads from Google Fonts, with a system-font fallback. Scene and audio assets are served locally.

## GitHub Pages

Deployment target: **https://derong-jin.github.io/grain-eld-demo/**.

GitHub Pages publishes the root of the `main` branch. The `.nojekyll` file preserves the static site without a Jekyll build. HTML, JavaScript, the preprocessing worker and scene assets use relative URLs so they work under the repository's `/grain-eld-demo/` path. The Python server is only for local development and is not needed online.

After committing updates, `git push origin main` triggers a new deployment. Check the repository's **Actions** tab for the Pages build/deployment status. CDN dependencies and the browser's click-to-play audio policy also apply to the online version.

## Included scenes

| Preset | Folder | Behavior |
| --- | --- | --- |
| Grain Rendering | `marble-scenes/spring1` | One stream, its original loop and 183 NHU05104248 grains at 50 events/s |
| ELD Visualization | `marble-scenes/spring` | 14 weighted spatial distributions; 3D scene and ELD only, with no audio rendering or source overlays |

**Grain Rendering** is selected initially. Choose a preset and click **Load Scene**; changing the selection alone does not load it. The ELD Inspector is open by default and opens again after every scene load. Its initial representation is **KDE with bandwidth 0.1 dB**. **Scene Path** remains editable for compatible scene folders served from this repository.

**ELD Visualization** keeps the original source positions, point-cloud data and weights only for ELD computation. It does not create source point-cloud meshes, centroids, labels or audio nodes, and does not fetch loops or grains. Audio controls and source-visibility buttons are hidden. Switching into it stops the previous scene's audio and grain scheduler, discards grain buffers, and closes the audio context. Returning to Grain Rendering creates audio as needed.

## Controls

- Click the 3D view to look around with the mouse; Escape releases it. **W/S** move forward/back, **A/D** left/right, **I/K** up/down. **Reset Camera to Origin** restores the initial view. The overview shows the scene and listener.
- The ELD Inspector lets you select spatial distributions and compare **Histogram**, **Gaussian** and **KDE** representations. Moving the camera updates the curves. **Dummy Gaussian** is available only for the single grain source. You can close and reopen the inspector.
- In Grain Rendering, **Play/Pause** or **Space** outside form fields controls audio. Click Play if your browser initially suspends audio. Stereo panning is the default; no HRIR downloads are required.
- **Switch to Loop Rendering** repeats the original recording. **Switch to Grain Rendering** returns to grain synthesis, which is the default content mode after loading the grain scene.
- **Window** selects None, Tukey (default alpha 0.25), or Hann. **Denoise** selects None (default) or Spectral. Changing preprocessing reloads the grains. Loop playback remains available during preparation or failure; **Retry Grain Load** retries failed assets.
- **Volume Audio / Point Audio** changes the spatial audio method in the grain scene. Its centroid/cluster toggles reveal the source position and point cloud.

See [the ELD model](ELD_POINT_CLOUD_MODEL.md) for equations and limitations, and [audio asset notes](AUDIO_SOURCES.md) for retained and retired recordings.

## Scene format

```text
marble-scenes/<scene>/
  3d/gaussian.compressed.ply
  render_cfg/choice.json
  render_cfg/*.ply, *_weights.npy
  audio/*.wav                     # audio sources only
  sound-grains/<dictionary>/       # grain-capable sources only
    dictionary.json
    rate.json
    noise-profile.json
    grains/*.wav
```

Each entry in `choice.json` references geometry (`pcd`, with `pcd_points` and `pcd_weights` for ELD) and its centroid. **Omitting `audio_path` makes the entry ELD-only**: no audio or 3D source overlay is created. Audio entries supply `audio_path` for their original loop and optionally `grain_path`, resolved under that scene's `sound-grains/` directory. The viewer accepts dictionary v1 and a rate file with `poisson_rate`. Spectral denoise uses the dictionary's relative `noise_profile.path`.

Dictionary source filenames and offline outputs are provenance only; the viewer never fetches them. Generation remains in the parent research project.

## Assets and Git

The two scenes contain **236 runtime files, about 97.75 MiB**, with a largest file of **31.05 MiB**. Gaussian PLY files are already compressed; PCM grains are retained without recompression. All resources fit ordinary Git, with no Git LFS or additional compression. Upload with `git push`; the remote repository is `derong-jin/grain-eld-demo`.

Spring's retired loops and grain libraries are no longer bundled in the working tree. The complete earlier audio version remains in Git history at `f3ad26b`; this change does not rewrite that history. A research copy is also preserved outside the viewer in `spring-grain-sources/retired-viewer-spring/` in the parent project. The standalone viewer does not depend on that copy.

## Validation

```sh
python3 tools/check_assets.py
node --input-type=module --check < demo.js
node --check grain-preprocess-worker.js
node --test tools/test_grain_runtime.mjs
```

Node is needed only for optional JavaScript checks. The asset checker verifies all runtime references, directory containment, 14 ELD-only entries, the single source's 183 grains, PCM formats, noise profiles and file sizes. The tests cover the grain lifecycle plus ELD-only loading without audio/overlays, closing a previous audio context, and weighted ELD computation without a render object.

Browser verification on 2026-10-06 confirmed both renamed presets, the default-open inspector and KDE bandwidth 0.1. ELD Visualization loaded all 14 distributions with no Spring audio/grain requests and no visible audio/source-overlay controls. Camera movement changed the ELD statistics; resetting the camera restored them. Grain Rendering loaded all 183 grains, switched between grain and loop content, and reopened the inspector after it had been closed. Switching back to ELD Visualization removed the grain scene's overlays and audio controls. No browser errors or warnings were reported during these checks.
