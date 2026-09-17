# Reference pose preprocessing

This offline Python CLI selects a continuous exercise reference from generally synchronized demonstrators. It is independent of gameplay, the live camera, avatar, Staff flow and player scoring. The video and reference timestamps are not changed.

## Install and run

Tested with Python 3.12 on Windows. From the repository root:

```powershell
python -m venv tools/reference-pose/.venv
tools/reference-pose/.venv/Scripts/python -m pip install -r tools/reference-pose/requirements.txt
tools/reference-pose/.venv/Scripts/python tools/reference-pose/extract_reference_pose.py --input assets/videos/e9d87196a2d98e530ab1ddebd7c56c5e.mp4 --output assets/games/demo-standing/reference-pose.json --fps 10
```

On macOS/Linux use `python3` and `.venv/bin/python`. If pip is unavailable, `uv pip install --python tools/reference-pose/.venv/Scripts/python -r tools/reference-pose/requirements.txt` is an alternative. MediaPipe includes OpenCV contrib; no additional OpenCV package is needed.

`--input` and `--output` are required. Use a repository-relative input path. `--fps` defaults to 10, must be positive, no higher than source FPS, and at most 1000. One dataset is used for the shared video.

The first run downloads the official Pose Landmarker Full float16 version 1 model; its SHA-256 is verified. `--model PATH` selects the cache path for that exact model. Subsequent extraction is local. MediaPipe uses CPU, VIDEO mode, up to **four candidates**, and 0.5 detection/presence/tracking confidence. Only one selected pose is stored at each timestamp. See the [official Pose Landmarker API](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/PoseLandmarker).

`--debug tools/reference-pose/.cache/sequence-candidates.json` optionally writes candidates and selection reasons separately. Do not commit these diagnostics. The virtual environment, model and cache are ignored. Debug output must differ from input, model and reference output.

## Continuous reference selection

`normalized-pose-sequence-v2` treats same-person identity as a preference. A reliable synchronized alternative is better than an unnecessary missing sample. This assumes synchronized demonstrators; it does not infer semantic exercise correctness.

- **Quality:** finite 33-point candidates need four shoulder/hip visibilities >=0.5, mean visibility >=0.7 over 12 major joints, and at least eight major joints at visibility >=0.5. Torso length must be >=0.03. The first unambiguous usable sample anchors selection by quality, then central position and a coordinate tie break. Detector array order is never a tie break.
- **Normalized movement:** correct x for video aspect ratio, subtract the hip midpoint, and divide by shoulder-midpoint to hip-midpoint length. Compare shoulders, elbows, wrists, hips, knees and ankles using visibility-weighted RMS distance over at least eight mutually reliable joints. Preserve anatomical left/right and torso lean: no mirroring or rotation matching.
- **Time-aware checks:** pose distance must be <=`min(1.1, 0.65 + 2 * elapsedSeconds)`. Lateral position and apparent scale changes are not rejection gates. Normalization handles ordinary side-to-side and forward/backward motion.
- **Same-person preference:** center and log-scale proximity, adjusted for elapsed time, rank the likely current demonstrator. That candidate costs zero extra; another costs 0.25. Ordinary movement of the current demonstrator accumulates no identity cost. An unavailable, unreliable or clearly inferior current pose may be replaced by a compatible alternative. This geometric association is not an identity guarantee.
- **Offline sequence:** bounded Viterbi-style search keeps up to 16 histories per sample. Cost combines `(1 - meanVisibility)`, `0.25 * poseDistance`, the same-person preference and `0.1 * nearest following-pose distance`. One following sample within 200 ms provides support against the same motion limit. Missing costs 0.8 when quality candidates exist; empty/black samples add no cost. Histories ending in the same candidate merge; backtracking chooses the cheapest retained path. Beam pruning is not an exact unlimited global optimum.
- **Honest missing data:** null states remember the last accepted pose, so missing cannot reset continuity and admit an incompatible replacement. Near-equal choices (cost margin <0.04) with conflicting poses (distance >0.9) remain missing. Initial ambiguity uses quality cost; later ambiguity uses transition, quality and future-support costs. There is no fixed five-second identity expiry, but the motion limit never grows beyond 1.1.

All selected landmarks remain raw MediaPipe coordinates. There is no interpolation, blending, smoothing, retiming, gameplay similarity score or player/reference comparison. Different people can have different proportions and imperfect synchronization; accepted poses can still contain inaccurate limbs.

## Usable coverage and format

At the requested sample rate, OpenCV grayscale luminance (0-255) marks near-black only when mean luminance is <=3 and at most 0.5% of pixels exceed 12. Runs lasting at least 500 ms become `coverage.inactiveRanges`; `usableRanges` is their complement. Ranges are **start-inclusive, end-exclusive**, on the source timeline. Boundaries are sampled estimates, not exact video edit points. Every near-black sample remains null, even an isolated dark sample too short to classify as an inactive range.

Usable means not excluded as near-black. It does not prove exercise activity or valid pose coverage. The tool does not infer intensity, trim video, remove samples or fill black-tail nulls. All-black videos have no usable ranges.

Format version 1 is retained. The file contains `sourceVideo`/source SHA-256, `poseModel` settings/hash/version, `video` dimensions/duration/FPS/frame count, `sampling` settings/decoder, `subjectTracking` strategy/settings, `coverage`, `usableRanges`, and ordered `frames: [{timeMs, landmarks}]`. Each selected pose has 33 `{x,y,z,visibility}` landmarks; missing is explicit `null`. The `subjectTracking` key is retained for compatibility even though the strategy is now movement-centered. Older files without coverage still validate.

Raw coordinates are unmirrored, unclamped normalized image landmarks; z is relative depth, not world distance. Sampling selects the first source frame at or after each zero-based grid time and rounds its timestamp to integer milliseconds. Constant frame rate, stable dimensions and usable zero-based timestamps are required; incomplete decoding or unsupported timing fails without replacing the output. The tool does not convert video. Candidate sequences are held in memory; very long videos may need a streaming design. Inference is not promised bit-identical across hardware/library versions.

## Validate and inspect

```powershell
python tools/reference-pose/validate_reference_pose.py assets/games/demo-standing/reference-pose.json
python -m unittest discover -s tools/reference-pose -p "test_*.py"
node --test --test-isolation=none tools/reference-pose/visualizer-data.test.mjs
node --experimental-vm-modules --test --test-isolation=none tests/pose-tracker.test.cjs
python -m http.server 8000
```

Open `http://localhost:8000/tools/reference-pose/visualizer.html`. HTTP(S) is required; `file://` shows instructions. The viewer reads stored JSON/video only: no MediaPipe import or inference. Play the whole usable region, then inspect switches and gaps with sample stepping, index jump and clickable missing ranges. Missing clears the overlay. The panel separately reports usable samples, selection percentage, missing-range count and longest exercise gap.

The overlay shares the video's intrinsic aspect ratio and uses raw x/y coordinates and standard MediaPipe connections. Nearest timestamp matching chooses the earlier sample on ties, with tolerance of half the requested interval plus one source frame and 1 ms (84.3 ms here). Larger gaps are not interpolated. Missing-range endpoints are first/last sampled times, not inferred loss boundaries. Low-visibility points are still drawn. The viewer loads the video into browser memory for reliable seeking with Python's basic HTTP server; use inline playback, since native fullscreen may omit the overlay. Metadata checks verify dimensions/duration, not source-byte identity. Reload stale browser modules after local edits.

## Current lower-resolution source

The current source video is 854 × 480, 1,730 decoded video frames at 30 FPS, and 57.666667 seconds on the decoded video timeline. Its AAC audio/container duration is 57.724807 seconds. The visualizer accepts that small difference within the same 84.3 ms tolerance used to match stored samples.

The current generated dataset has 577 samples: 554 selected and 23 missing. All 577 samples are in usable coverage, so selected usable coverage is 96.01%. There are 10 missing ranges; the longest sampled span is 24.600–25.800 seconds (13 samples, 1.2 seconds). The replacement source has no sustained black tail, so `coverage.inactiveRanges` is empty. At the browser-reported end of the slightly longer audio/container timeline, no stale reference sample is drawn.

## Historical PR #11 comparison and diagnosis

The comparison below records why the continuity algorithm changed while the original 1280 × 720, 73.199667-second source was present. It is historical evidence, not the metadata or current metrics for the lower-resolution replacement video.

Baseline is the first PR #11 commit, `b8d40a5`. Regeneration preserves its source hash, all 732 timestamps, video metadata and coverage. The real extraction took 29.44 seconds excluding imports. Four candidates were requested; detector confidence settings did not change.

| Measure | Fixed-person baseline | Pose sequence |
| --- | --- | --- |
| Total samples | 732 | 732 |
| Selected | 441 | 545 |
| Missing total | 291 | 187 |
| Usable exercise samples | 577 | 577 |
| Missing inside usable range | 136 | 32 |
| Selected inside usable range | 76.43% | 94.45% |
| Exercise missing ranges | 10 | 14 |
| Longest exercise missing sampled span | 4.200 s (43 samples) | 0.600 s (7 samples) |
| Black-tail nulls | 155 | 155 |

Usable coverage remains `[0, 57733)` ms; inactive coverage remains `[57733, 73199.6667)` ms. Missing exercise samples fell 76.47%. Long gaps became shorter gaps, so range count increased. This fills 111 old nulls and introduces seven new nulls for quality/continuity; overall detection percentage alone is not the acceptance measure.

Before implementation, saved candidates were replayed through the original tracker and every baseline output matched. Of 136 missing exercise samples, **119 had returned candidates rejected by the tracker**, across nine of ten ranges; **17 had no candidates**. A preliminary screen (visible torso, >=10 of 12 joints at visibility 0.5, mean >=0.7) found a quality candidate in 113 missing samples, including a left-side alternate in 107. These count quality availability, not confirmed movement compatibility.

| Timestamp | Candidates | Mean major visibility / reliable joints | Diagnosis |
| --- | --- | --- | --- |
| 6.633 s | 1 | 0.897 / 12 | Front-left alternate rejected by absolute position/displacement; synchronized fallback available |
| 14.033 s | 2 | 0.986 / 12; 0.851 / 10 | Alternatives rejected by position/displacement; quality fallback available |
| 15.633 s | 0 | None | Detector returned no pose |
| 16.533 s | 1 | 0.788 / 9 | Position rejection plus limited reliable joints; excluded from the preliminary 10-joint quality count |
| 18.033 s | 2 | 0.989 / 12; 0.984 / 12 | Rear/left alternatives rejected by position, scale or displacement |
| 23.733 s | 1 | 0.977 / 12 | Current front-right person returned; scale ratio 1.3518 narrowly exceeds old 1.35 limit after 1.6 s loss |
| 23.933 s | 0 | None | Detector returned no pose |
| 31.633 s | 1 | 0.990 / 12 | Front-left alternate rejected by fixed-person position/displacement |
| 55.133 s | 1 | 0.950 / 12 | Front-left alternate rejected by fixed-person position/displacement |

Final exercise nulls: 17 detector-empty samples, one insufficient-quality sample, 12 inconsistent-movement samples and two sequence rejections. Black frames are counted separately.

### Playback findings and limits

The dataset was played continuously at normal speed through the entire usable region into the black tail, with regular browser screen captures rather than timestamp-only navigation. Boundary checks also compared 12.933/13.033 s and 38.433/38.533 s. Playback covers lateral steps, forward/backward movement, turns, side-facing arms, overlaps and person changes.

Coverage is substantially more continuous, especially in the former 14.433-18.333 and 31.633-35.833 s gaps. The overlay changes between front demonstrators and uses the rear demonstrator around 24-26 s. Examples include 6.333/6.933, 11.333, 23.733 and 35.933 s. Screen relocation is expected when displaying another person's raw coordinates; it is not itself an artificial exercise-pose change. No clearly unrelated-movement switch was confirmed during review. This is not a certified frame-by-frame harmful-event count: captures are about one second apart, and the demonstrators are not perfectly synchronized.

Side-facing arm drift, hand/foot errors and brief jitter remain. Rapid arm changes still merit manual QA before scoring. Geometry cannot prove semantic exercise correctness, synchronization or identity through camera cuts; not every harmful discontinuity is guaranteed to be removed. The intended input is a stable-camera video of synchronized exercise.

Remaining missing exercise spans (first-last sample): 14.533; 14.733-14.833; 15.433; 15.633-16.233; 16.633; 17.233; 17.433-17.533; 20.733; 22.833-23.133; 23.333-23.633; 23.933-24.033; 28.133-28.433; 37.633; 38.733 s. The longest is seven detector-empty samples at 15.633-16.233 s: 0.600 s sampled span, about 0.7 s of sampled coverage. The black tail retains all 155 nulls and an empty overlay.
