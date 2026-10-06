# Audio assets

**Grain Rendering** (`marble-scenes/spring1`) keeps its existing `NHU05104248` stream recording and 183-grain library, dictionary, 50 events/s rate and noise profile unchanged. Existing provenance is retained in its dictionary; no new license is asserted for these pre-existing assets.

**ELD Visualization** (`marble-scenes/spring`) has no runtime audio. Its former 14 loop recordings, copied stream grains, 36 waterfall grains and 12 leaf grains were removed from the viewer working tree when this scene became visualization-only. Its source geometry and weights remain for ELD computation.

The former Spring audio implementation, exact FSD50K/Freesound attribution and `audio-sources.json` are recoverable in Git commit `f3ad26b`. Research copies, including the source WAVs, generation parameters, hashes and licenses, remain outside the standalone viewer in the parent project's `spring-grain-sources/` directory. Retired viewer assets and their complete provenance are preserved under `spring-grain-sources/retired-viewer-spring/`.

The parent regeneration script now writes to that research archive, so regenerating the recordings does not restore audio to ELD Visualization. No archived file is needed to run this viewer.
