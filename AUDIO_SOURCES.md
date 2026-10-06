# Spring audio sources

Spring keeps all 14 original loop recordings and source geometries. Grain Rendering replaces playback only for the waterfall, two streams and four wind-in-tree sources. Five `3_tree_*` bird sources and two `4_flowers_*` insect sources continue playing their original loops.

| Library | Recording and author | License | Grain count | Source use |
| --- | --- | --- | ---: | --- |
| `NHU05104248` | Existing Spring1 stream library | Existing asset provenance retained | 183 | Two streams |
| `waterfall-348818` | [Close Waterfall 1 — Yoyodaman234, ID 348818](https://freesound.org/people/Yoyodaman234/sounds/348818/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 36 | One waterfall |
| `leaves-390849` | [RustlingLeaves01.wav — nickyg11p, ID 390849](https://freesound.org/people/nickyg11p/sounds/390849/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 12 | Four `2_tree_*` sources |

The two new recordings were obtained as `FSD50K.dev_audio/348818.wav` and `FSD50K.dev_audio/390849.wav` from the [official FSD50K release](https://zenodo.org/records/4060432). ZIP CRC checks verified the extracted bytes. FSD50K's metadata names the original Freesound authors and the CC0 licenses above. These are the dataset's **44.1 kHz, mono, 16-bit PCM WAV** versions; the original Freesound uploads can have a different format. No additional channel conversion or lossy compression is applied here. The dataset's documentation/metadata attribution is distinct from the individual recordings' licenses.

Dataset reference: Eduardo Fonseca, Xavier Favory, Jordi Pons, Frederic Font and Xavier Serra, *FSD50K: an Open Dataset of Human-Labeled Sound Events*, IEEE/ACM Transactions on Audio, Speech, and Language Processing, 30, 829–852, 2022. DOI: [10.5281/zenodo.4060432](https://doi.org/10.5281/zenodo.4060432).

## Processing

- **Waterfall:** 28.709252 seconds; input level retained.
- **Leaves:** 8.885397 seconds; constant **+32.153782 dB** applied before segmentation. This matches the median RMS of the four original wind loops (about −33.395 dBFS), subject to a −3 dBFS peak ceiling. It preserves variation within the recording and does not modify any original scene loop. The leveled recording peaks at about −6.61 dBFS.
- **Segmentation:** existing `sound_grain_gen.py`; hop 10 ms, smoothing 50 ms, noise percentile 5, threshold offset 1 dB, hysteresis 4 dB, minimum silence 80 ms, minimum/maximum core duration 100/1000 ms, padding 10 ms on each side, fade 5 ms. Padding can make an exported grain slightly longer than 1000 ms.
- **Scheduling:** 50 Poisson events/s independently per grain-capable source. Buffers are shared by library; source positions, spatial weights and ELD remain independent. The existing renderer applies overlap and per-grain RMS matching.
- **Noise profiles:** waterfall uses the existing inactive-region estimator. Leaves have insufficient inactive audio, so their profile uses the lowest-energy 5% of 1024-sample frames at a 256-sample hop. Both use Hann-windowed median periodograms, the existing ln(2) bias correction, and three-bin smoothing. The leaf profile includes quiet leaf texture; it is an estimate, not a separately recorded noise floor. Spectral denoise defaults to off.
- **Runtime defaults:** Tukey window, alpha 0.25; no denoise; KDE bandwidth 0.1 dB; stereo panning.

[audio-sources.json](audio-sources.json) records the original and leveled WAV SHA-256 hashes, ZIP CRCs, exact generation parameters, licenses and profile methods. Dictionary source filenames are provenance only and are never fetched by the viewer.

The existing Spring1 library is copied byte-for-byte into Spring, including its 183 grains, dictionary, rate and noise profile. Identical contents are stored once by Git. No new BBC recordings are introduced by this change; the new clips' CC0 licenses do not change the licenses of pre-existing assets.

## Offline reproduction

Generation code, downloaded source WAVs and analysis outputs remain in the parent research project under `spring-grain-sources/`, outside this standalone viewer repository. From that parent project:

```sh
python3 spring-grain-sources/fetch_fsd50k.py 348818 390849
.venv/bin/python spring-grain-sources/build_spring_grains.py
```

The fetcher reads selected ranges of the public split ZIP archive instead of downloading the entire dataset. The builder uses the existing generator and NumPy-based noise estimator, applies the documented leaf level adjustment, and copies only required runtime assets into the viewer. Python plus NumPy are needed only for regeneration; serving the viewer still needs only Python's standard library.
