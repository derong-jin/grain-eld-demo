# Point-cloud ELD visualization and grain-rendering model

This note documents the optional ELD Inspector in index.html. It visualizes
direct-path event loudness distributions derived from weighted source point
clouds. Histogram, Gaussian, and KDE derive their parameters from those
samples; a fourth manual Dummy Gaussian is available in eligible single-source
scenes. The selected representation drives both the plot and the relative
event levels of the optional real-time grain renderer.

## 1. Cornell ELD definition

Zhang et al. define the event loudness density (ELD), \(E(L;x)\), as the
temporal density of event arrivals at listener position \(x\), expressed as a
function of received event loudness \(L\). An absolute ELD has units
events/s/dB, and its integral is the received event rate.

Their full method propagates compact pulses with a wave simulation,
deconvolves the received pressure, detects peaks of amplitude \(A\), and maps
them to

\[
L = 10\log_{10}(A^2) = 20\log_{10}|A|.
\]

The paper stores these arrivals in 3 dB loudness bins. The current demo uses
the same ELD interpretation but deliberately omits wave propagation and
reflections.

## 2. Shared direct-path point-cloud samples

For source \(s\), let point \(p_i\) have normalized spatial weight \(w_i\), and
let the listener be at \(x\). The direct-path distance, amplitude, and relative
loudness are

\[
r_i = \max(\|p_i-x\|,r_{\min}), \qquad
g_i = \frac{r_{\mathrm{ref}}}{r_i},
\]

\[
L_i = L_{\mathrm{ref}} + 20\log_{10}g_i
    = L_{\mathrm{ref}} -
      20\log_{10}\frac{r_i}{r_{\mathrm{ref}}}.
\]

All three point-cloud methods use the same weighted \(L_i\) samples. Their compact
summary statistics are

\[
\mu_s = \sum_i q_i L_i,\qquad
\sigma_s^2 = \sum_i q_i(L_i-\mu_s)^2,\qquad
q_i=\frac{w_i}{\sum_jw_j}.
\]

The UI labels these as sample \(\mu\) and sample \(\sigma\). They describe the
shared point-cloud loudness samples, not the extra Gaussian scale/floor or KDE
bandwidth applied by a representation.

The full PLY and matching NPY weights are loaded lazily. Clouds larger than
4096 points use deterministic weighted resampling, so their displayed
distribution is an interactive approximation of the full weighted cloud.

## 3. ELD representation options

### 3.1 Gaussian ELD

Gaussian mode retains only the weighted mean and variance. Its displayed
standard deviation is

\[
\sigma_{\mathrm{eff}} =
\max(\alpha\sigma_s,\sigma_{\mathrm{floor}}),
\]

where \(\alpha\) is Sigma scale and \(\sigma_{\mathrm{floor}}\) is Min sigma.
The source ELD is

\[
E_s(L)=
\frac{1}{\sqrt{2\pi}\sigma_{\mathrm{eff}}}
\exp\left[
-\frac{(L-\mu_s)^2}{2\sigma_{\mathrm{eff}}^2}
\right].
\]

Adaptive display support is
\([\mu_s-4\sigma_{\mathrm{eff}},\mu_s+4\sigma_{\mathrm{eff}}]\).

### 3.2 Gaussian-kernel KDE

KDE mode retains the full sampled \(L_i\) distribution and smooths it with
bandwidth \(h\):

\[
E_s(L)=
\sum_i q_i\,
\frac{1}{\sqrt{2\pi}h}
\exp\left[-\frac{(L-L_i)^2}{2h^2}\right].
\]

The implementation deposits weighted samples onto a fine loudness grid and
applies a Gaussian kernel truncated at \(4h\). This avoids an expensive direct
sample-by-pixel evaluation when many sources are selected. Adaptive display
support is
\([\min_iL_i-4h,\max_iL_i+4h]\).

### 3.3 Weighted histogram

Histogram mode uses bin width \(\Delta L\), with bin centers anchored at
\(L_k=k\Delta L\) and edges at \(L_k\pm\Delta L/2\):

\[
E_{s,k} =
\frac{1}{\Delta L}
\sum_i q_i\,
\mathbf{1}
[L_k-\Delta L/2 \le L_i < L_k+\Delta L/2].
\]

It is rendered as a step function across the actual bin edges. No smoothing is
applied. Adaptive display support includes the occupied bins plus one empty bin
on each side.

### 3.4 Dummy Gaussian

Dummy Gaussian is a manual representation with arguments \(\mu_d\) and
\(\sigma_d\):

\[
E_d(L)=
\frac{1}{\sqrt{2\pi}\sigma_d}
\exp\left[-\frac{(L-\mu_d)^2}{2\sigma_d^2}\right].
\]

It does not fit the point-cloud samples. When selected, it replaces the
point-cloud curve rather than being added as another source. Its adaptive
display support is \([\mu_d-4\sigma_d,\mu_d+4\sigma_d]\).

## 4. Normalization and multiple sources

Each source representation is normalized over the complete loudness axis:

\[
\int E_s(L)\,dL=1.
\]

Independent selected sources add rather than average:

\[
E_{\mathrm{selected}}(L;x)=\sum_{s\in S}E_s(L;x),
\qquad
\int E_{\mathrm{selected}}(L;x)\,dL=|S|.
\]

The scene metadata has no calibrated event rate, so this is a relative ELD.
The x-axis is relative dB re 1 scene unit; the y-axis is relative ELD per dB.
For multiple point-cloud sources, the white curve is the selected-source sum.
Dummy Gaussian uses the same active-curve styling as other single-source
representations, is restricted to one source, and therefore has unit integral
rather than a multi-source sum.

## 5. Real-time grain rendering

For a non-global source with `grain_path: "NAME"`, the demo resolves

```text
SCENE/sound-grains/NAME/dictionary.json
SCENE/sound-grains/NAME/rate.json
SCENE/sound-grains/NAME/noise-profile.json  # spectral denoise only
```

and reads only the relative WAV paths stored in `dictionary.json`. Grain WAVs
are decoded with bounded concurrency when a grain-capable scene loads (Grain
Rendering is the default), or reloaded when a preprocessing option changes. During
preparation for Grain Rendering, both buses of grain-capable sources are set
to zero and their active grain nodes are stopped. Other sources, including
Spring's birds and insects, continue their original loops. Muted loops keep
their playback position. Preparation while Loop Rendering is selected leaves
the loops audible. Users can return to Loop during loading or after a failure;
late results cannot change that choice. A failed library is named and can be retried.

Libraries are shared within a scene by absolute asset URL, AudioContext sample
rate and preprocessing settings. WAV decoding, window/denoise processing and
RMS statistics happen once per library. ELD point samples, gain, panning,
event times and active audio nodes remain per source. Spring's seven grain
sources use three libraries, totaling 231 unique grains. Scene teardown aborts
pending library work and releases buffers.

The browser demo does not load an external `eld.json`. Its grain-event
loudness distribution comes from the Representation selected in the inspector:
one of the live point-cloud methods or, in an eligible single-source scene, the
manual Dummy Gaussian.

`rate.json` supplies `poisson_rate` in events/second. Successive event gaps are
independent exponential samples,

\[
\Delta t=-\frac{\ln(1-U)}{\lambda},\qquad U\sim\mathcal U(0,1),
\]

and grains are selected uniformly with replacement. The scheduler uses
`AudioContext.currentTime`, a 25 ms timer, and a 100 ms look-ahead. Missed
events are discarded after a delayed browser timer rather than emitted as a
catch-up burst.

At each event, the renderer samples a loudness (L) from the currently chosen
Histogram, Gaussian, KDE, or Dummy Gaussian representation. The existing
source spatial gain still supplies the current directional rendering path. If
its scalar gain is \(g_s\), the event envelope compensates that already-present
gain in dB,

\[
L_g=20\log_{10}g_s,\qquad
\Delta L=L-L_g,\qquad
g_{\mathrm{event}}=10^{\Delta L/20}.
\]

Thus the combined scalar level is
\(g_sg_{\mathrm{event}}=10^{L/20}\): the selected ELD loudness is audible
without applying source distance attenuation twice. It remains a relative-level
model with no absolute SPL-to-dBFS calibration. Before applying this offset,
grains with a finite
`features.rms_dbfs` value are RMS-normalized to the dictionary's median grain
level, matching the offline synthesizer's principle that grain choice should
not accidentally redefine the sampled event level. To leave headroom for
overlap, the implementation also multiplies each event by

\[
g_{\mathrm{overlap}}=
\frac{1}{\sqrt{\max(1,\lambda\bar T)}},
\]

where \(\bar T\) is mean decoded grain duration. A 5 ms playback edge envelope
is used only when the preprocessing Window option is None. Tukey/Hann grains
already contain their selected full-grain window and therefore do not receive
another scheduler fade.

### 5.1 Grain preprocessing and reload lifecycle

The browser offers None, Tukey, and Hann windows. Tukey has a configurable
alpha, with 0 acting as a rectangular window and 1 matching Hann. It also
offers optional linked-channel spectral denoising with configurable subtraction
strength and maximum attenuation. The processing order matches the offline
synthesizer:

```text
decode WAV -> spectral denoise (optional) -> grain window (optional)
           -> measure processed RMS -> commit the complete grain set
```

Spectral mode reads the `noise_profile.path` declared in `dictionary.json`.
The parent research project’s `build_noise_profile.py --attach` estimates that profile from inactive regions
of the original recording as a Hann-windowed, median-corrected periodogram.
Spring's continuous leaf recording lacks enough inactive audio, so its offline
builder uses the lowest-energy 5% of frames with the same spectral estimator.
This includes quiet leaf texture and is not an independently measured noise floor;
see [audio source processing](AUDIO_SOURCES.md).
The real-time mask uses linked stereo power, two frequency-smoothing passes,
5 ms attack, 60 ms release, and overlap-add reconstruction. Processing runs in
a Web Worker; processed buffers replace the decoded cache only after the full
library finishes. Library abort controllers, source revisions and scene/mode
generations prevent stale work from overwriting a newer selection.

If `decodeAudioData()` resamples a grain to the AudioContext rate, the worker
interpolates the stored noise powers by physical frequency, scales them for
the new FFT-bin bandwidth, and treats frequencies above the source Nyquist as
zero before constructing the linked mask.

The processed RMS values, rather than the dictionary's pre-processing RMS,
form the median reference used for grain-level matching. This keeps window or
denoise selection from accidentally introducing grain-to-grain loudness jumps.

### 5.2 Single-source Dummy Gaussian representation

When the scene has exactly one non-global source with `grain_path`, the ELD
Inspector enables Dummy Gaussian as a fourth item in the Representation list,

\[
L_d\sim\mathcal N(\mu_d,\sigma_d^2).
\]

Its per-method arguments are the mean \(\mu_d\) in dB and standard deviation
\(\sigma_d\) in dB. Selecting it makes the manual Gaussian the active plot and
simultaneously makes it the grain renderer's event-level distribution. Its
event offset is

\[
\Delta L_d=L_d-L_g.
\]

Consequently, dummy \(\mu_d\) directly controls the received event-level center,
while \(\sigma_d\) controls event-to-event level variation. With zero or
multiple live sources, or when the sole source has no `grain_path`, the option
is disabled. If it was active during a scene transition, Representation is
forced back to the most recently used point-cloud method.

## 6. Display range options

Each method first produces an adaptive support interval \([a,b]\). Range length
and range position are controlled independently:

| Length | Position | Result |
| --- | --- | --- |
| Adaptive | Adaptive | Center at \((a+b)/2\), span covers the support |
| Fixed | Adaptive | Follow the support center using the manual span |
| Adaptive | Fixed | Keep the manual center and expand enough to contain the support |
| Fixed | Fixed | Use the manual center and manual span exactly |

For fixed span \(W\) and center \(C\),

\[
x_{\min}=C-\frac{W}{2},\qquad
x_{\max}=C+\frac{W}{2}.
\]

A fixed range may intentionally crop probability mass. Cropped curves are not
renormalized, because changing the camera or display range must not change the
ELD height. The UI therefore reports visible integral divided by the full
nominal integral. In adaptive mode, Dummy Gaussian uses
\(\mu_d\pm4\sigma_d\).

## 7. Current defaults

| Option | Default |
| --- | ---: |
| Representation | KDE |
| Gaussian sigma scale | 1.0 |
| Gaussian minimum sigma | 0.5 dB |
| KDE bandwidth | 0.1 dB |
| Histogram bin width | 3 dB |
| Dummy Gaussian mean | -20 dB |
| Dummy Gaussian sigma | 4 dB |
| Range length | Adaptive |
| Fixed span value | 60 dB |
| Range position | Adaptive |
| Fixed center value | -30 dB |
| Reference distance | 1 scene unit |
| Near-field clamp | 1 scene unit |
| Maximum retained samples | 4096/source |
| Camera-driven update rate | Up to 10 Hz |
| Grain asset load concurrency | 6 requests/shared library |
| Grain scheduler tick / look-ahead | 25 ms / 100 ms |
| Maximum accepted Poisson rate | 100 events/s |
| Loop/grain crossfade | 20 ms |
| Grain window | Tukey, alpha 0.25 |
| Grain denoise | None |
| Real-time grain edge fade | 5 ms when Window is None |

## 8. Limitations

- There is no reflection, reverberation, diffraction, occlusion, visibility,
  material, directionality, frequency dependence, or air absorption model.
- The \(1/r\) amplitude law is relative rather than calibrated SPL.
- Gaussian mode can hide asymmetry and multiple modes.
- KDE bandwidth and histogram width are display/model choices, not inferred
  acoustic ground truth.
- Large-cloud systematic resampling is suitable for interactive inspection but
  is not an exact full-cloud histogram or KDE.
- At high Poisson rates, many independent grains overlap and average out ELD
  variance; lowering the rate makes variance comparisons easier to hear.
- The point-cloud ELD and grain renderer are geometric approximations, not a
  replacement for the Cornell paper's propagated ELD field.

## References

- [Cornell project page: Acoustic Texture Rendering for Extended Sources in Complex Scenes](https://www.cs.cornell.edu/projects/ambientsound/acoustictexture/)
- [Zhang et al., ACM TOG / SIGGRAPH Asia 2019 paper](https://www.cs.cornell.edu/projects/ambientsound/acoustictexture/SAsia2019AcousticTexture.pdf)
