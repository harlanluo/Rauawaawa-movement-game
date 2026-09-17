# Reference pose preprocessing

This standalone Python CLI turns one exercise video into reference pose JSON before gameplay. It is independent of seated/standing game metadata and has no browser integration, scoring, smoothing, interpolation, or player comparison. Normal gameplay never analyses the demonstration video live.

## Install and run

Tested with Python 3.12 on Windows. Use a virtual environment and the two pinned dependencies (MediaPipe includes OpenCV contrib as a dependency, so no second OpenCV package is needed). No npm framework or build system is added.

From the repository root:

```powershell
python -m venv tools/reference-pose/.venv
tools/reference-pose/.venv/Scripts/python -m pip install -r tools/reference-pose/requirements.txt
tools/reference-pose/.venv/Scripts/python tools/reference-pose/extract_reference_pose.py --input assets/videos/e9d87196a2d98e530ab1ddebd7c56c5e.mp4 --output assets/games/demo-standing/reference-pose.json --fps 10
```

On macOS/Linux use `python3` to create the environment and `.venv/bin/python` in place of `.venv/Scripts/python`. If the Python distribution has no pip, `uv pip install --python tools/reference-pose/.venv/Scripts/python -r tools/reference-pose/requirements.txt` is an alternative.

`--input` and `--output` are required. Use repository-relative input paths to keep `sourceVideo` portable. `--fps` defaults to **10**, a compact starting point for gentle movements, and must be positive and no higher than source FPS (maximum 1000). Future videos use the same command with different paths. Only one dataset is needed when games share the same physical video.

The first run downloads the official **Pose Landmarker Full float16 version 1** model into this tool directory. It is the Full profile used by the standalone camera prototype, pinned to version 1 instead of `latest`; Heavy is not used. A SHA-256 check rejects incorrect/corrupt model files. `--model PATH` selects an existing copy of that exact model, or the download destination if absent. Internet is only needed for installation/model download; subsequent extraction is local. The virtual environment, cache, and model binary are ignored by Git.

MediaPipe uses CPU, VIDEO mode, up to **four candidate poses**, and explicit 0.5 detection/presence/tracking confidence settings. Only one selected subject is stored per sample. These are inference settings, not scoring thresholds. See the [official Pose Landmarker API](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/PoseLandmarker).

## Subject selection and loss

`subject_tracking.py` implements deterministic `torso-continuity-v1` using normalized image x/y coordinates. Candidates need all four shoulder/hip landmarks at visibility ≥0.5 and shoulder-midpoint to hip-midpoint length >0.03.

- **Initial subject:** minimize horizontal distance to image center, plus 0.2 × vertical center distance, minus 0.3 × torso length and 0.08 × mean visibility of nose, shoulders, hips and ankles. This favors central, prominent, visible full-body candidates. An exact score tie uses the landmark coordinate tuple, never candidate array order. In this video it selects the front-right demonstrator; the heuristic cannot infer the author's intended person.
- **Continuity:** compare with the last accepted pose. Center movement must be ≤0.08 normalized units **and** ≤0.4 previous torso lengths; torso scale ratio must be ≤1.35; mean displacement of the four corresponding shoulder/hip points must be ≤0.6 torso lengths. Rank survivors by center distance / previous torso length + absolute log scale ratio + 0.5 × normalized torso displacement. Arms are not identity anchors because they move widely during exercise.
- **Uncertainty:** no passing candidate, or two best scores separated by <0.2, produces `landmarks: null` without updating the last accepted pose. Missing is preferred to silently comparing a future player against a different person. Detector order does not select the subject.
- **Reacquisition:** allow the same strict position/scale/torso gates for up to 5,000 ms after the last accepted sample; do not widen gates during loss. Five seconds accommodates this video's roughly four-second candidate omissions. After that, identity expires for the rest of the extraction: no automatic restart, even after a scene change. There is no long-term appearance recognition or trajectory prediction.

The compact `subjectTracking` metadata records strategy/version and thresholds. The CLI summary counts selection/rejection reasons. Optional `--debug tools/reference-pose/.cache/candidates.json` writes per-sample candidates and reasons separately for QA; do not commit that diagnostic file. It must differ from the source, model and reference output.

## Usable coverage

At the requested sample rate, OpenCV grayscale luminance (0–255) marks a sample near-black only if its mean is ≤3 and at most 0.5% of pixels exceed 12. Runs lasting at least 500 ms become `coverage.inactiveRanges`; `usableRanges` is their complement. Each range is **start-inclusive, end-exclusive** on the original source timeline. Boundaries are sampled estimates (up to one sampling interval), not exact edit points. Near-black samples have null landmarks, including isolated dark samples too short to classify as an inactive range.

This detects sustained near-black content only. “Usable” means not excluded as near-black: it does **not** prove exercise activity, correct identity, or valid pose coverage. A missing pose inside a usable range is still missing. The tool does not infer movement intensity, trim video, remove samples, shift timestamps or implement scoring. All-black videos have no usable ranges.

## Format version 1

JSON contains:

- `formatVersion: 1`, `sourceVideo` (repository-root-relative for the command above), and source SHA-256.
- `poseModel`: profile, pinned URL, model SHA-256, MediaPipe version, delegate, mode, number of poses, inference settings.
- `video`: duration in milliseconds, decoded width/height, source FPS, decoded frame count.
- `sampling`: requested FPS, selection strategy, timestamp basis, decoder/version.
- `subjectTracking`, `coverage` and `usableRanges`: additive metadata described above. Version 1 is retained because frame representation and timestamp meaning are unchanged; validators and the viewer still accept older files without coverage metadata.
- `frames`: ordered `{timeMs, landmarks}` records. A detected pose has exactly 33 landmarks in standard MediaPipe order, each with `x`, `y`, `z`, and `visibility`. No detection is explicitly `landmarks: null`. Unavailable visibility is `null`; low visibility values are retained without filtering or inventing coordinates.

Coordinates are MediaPipe normalized image landmarks, unmirrored and untransformed. Values are not clamped: coordinates can extend outside the image, and z is relative depth, not a world-space distance. Body-relative normalization, joint angles, scale/torso alignment and temporal tolerance belong to later comparison work. No movement labels or scores are stored.

The decoder reads sequentially and selects the first frame at or after each zero-based sampling-grid time. Timestamps refer to selected source frames, rounded to integer milliseconds; sampling can differ from the target by up to one source frame. Output order is deterministic, but model inference is not promised to be bit-identical across hardware/library versions. Duration is decoded frame count / source FPS.

Supported inputs have constant frame rate, stable dimensions, and usable zero-based presentation timestamps. Variable/missing timing or incomplete decoding fails without replacing an existing output. Convert such input to constant frame rate separately before extraction; automatic conversion is out of scope. Geometry cannot guarantee identity when similar people overlap, cross, or replace each other in the same position. Fast motion, occlusion, camera cuts, small/hidden torsos and detector omissions can create false gaps. Stationary-camera exercise videos with separated demonstrators are the intended setting. The tool stores samples in memory before writing validated compact JSON atomically; very long videos may need a future streaming implementation.

## Validate

```powershell
python tools/reference-pose/validate_reference_pose.py assets/games/demo-standing/reference-pose.json
python -m unittest discover -s tools/reference-pose -p "test_*.py"
node -e "const d=JSON.parse(require('fs').readFileSync('assets/games/demo-standing/reference-pose.json','utf8')); console.log(d.formatVersion,d.frames.length)"
```

Validation checks version, metadata, finite coordinates, visibility, 33 landmarks, explicit missing poses, strictly increasing in-duration timestamps, target schedule and coverage through the end. The CLI reports duration, detected/missing counts, detected percentage, effective FPS, first/last timestamp, output bytes and runtime. A missing pose is valid output; detection percentage is not a measure of landmark accuracy.

Run the browser game with `python -m http.server 8000` and open `http://localhost:8000/`, or use HTTPS. Opening `index.html` with `file://` is unsupported. The extractor does not change live camera or avatar behaviour.

## Current real-video result

The existing 1280 × 720 video has 2,196 decoded frames and 73,199.67 ms duration. Regeneration at 10 FPS preserves all 732 timestamps exactly (first/last 0 / 73,133 ms), plus the source hash. Four candidates are requested; this run returned at most three. Extraction took 26.40 seconds excluding Python imports.

| Measure | Before (PR #10 base) | After |
| --- | --- | --- |
| Total samples | 732 | 732 |
| Detected / selected | 564 (77.05%) | 441 (60.25%) |
| Missing | 168 | 291 |
| Longest missing sampled span | 57.733–73.133 s, 155 samples | Same |
| Usable coverage | Unspecified | [0, 57.733) s |
| Inactive coverage | Unspecified | [57.733, 73.19967) s |

There are 136 missing samples inside usable coverage and 155 in the black tail. Compared with the old data, 124 previously detected samples become missing, and one previously missing sample becomes detected. This trades coverage for subject consistency; it does not establish scoring suitability. Replaying all actual candidates in reverse array order produced identical selected output.

## Visual QA

From the repository root run `python -m http.server 8000`, then open
`http://localhost:8000/tools/reference-pose/visualizer.html` (HTTP(S) required; `file://` shows instructions).
The separate development page displays the existing video and pre-generated JSON only. It does **not** load MediaPipe or a model, run inference, or change gameplay.

Use normal video controls, Previous/Next sample, a 0-based sample index, or Next missing sample (wraps to the first missing sample). Stepping pauses and seeks the video. Skeleton and points can be toggled separately. The QA panel reports timestamps, signed delta, detection and totals. Missing poses clear the canvas and show an amber message; clickable ranges group consecutive null samples. Range endpoints are first/last sampled timestamps, not estimated continuous detection-loss boundaries.

Matching uses binary search for the nearest timestamp, with ties choosing the earlier sample. Maximum distance is half the requested sample interval plus one source frame plus 1 ms for rounding (±84.3 ms for this dataset). Larger gaps show no match; no landmarks are interpolated. Drawing uses raw normalized coordinates and the standard [MediaPipe pose connections](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/python/solutions/pose_connections.py). Low-visibility points remain visible, so uncertain limbs can look inaccurate.

The page checks format, source path, timestamps, landmark values/count, and loaded video dimensions/duration. The video is fetched into browser memory as a blob so seeking works even with Python's basic server without byte-range support; no physical asset copy is created. Long videos need additional browser memory. This is an inline inspection tool: native video fullscreen/Picture-in-Picture is discouraged because it may omit the canvas. Metadata validation does not prove the video's byte identity (no source-hash comparison).

Run focused tests with `node --test --test-isolation=none tools/reference-pose/visualizer-data.test.mjs` in addition to the Python tests above and `node --experimental-vm-modules --test --test-isolation=none tests/pose-tracker.test.cjs` for existing camera/avatar tests.

### Real-data inspection findings

Before: PR #10's visual review found no obvious global offset or mirroring, but the stored pose switched between front-left and front-right people. Its missing spans were 15.233–16.233 s, 29.233 s, 37.233 s and 57.733–73.133 s.

After: browser inspection used the existing visualizer at 0, 18.333 (25%, missing), 18.433 (return), 36.633 (middle), 54.933 (75%) and 72.033 s, plus every missing-range start below. Further return/movement checks at 23.833, 26.233, 35.933, 37.633, 46.533 and 57.633 s kept the skeleton on the front-right demonstrator. **No person switches were seen in these checks**, but this is not a frame-by-frame identity guarantee. Side-facing arm drift remains, visibly at 54.933 and 57.633 s; hand/foot errors also remain in some accepted poses.

New missing sampled spans (first–last timestamp): 6.633–6.833, 14.033–14.133, 14.433–18.333, 22.233–23.733, 23.933–24.033, 24.233–26.133, 28.833–28.933, 31.633–35.833, 36.933–37.533, 55.133, and 57.733–73.133 s. The first ten starts show exercise content, so these are real detection/identity gaps, not inactive sections. The longest exercise gap is 31.633–35.833 s (43 samples, 4.200 s sampled span). The final range starts black and the near-end check is black; the viewer labels it inactive and clears the skeleton. It shows usable coverage separately from pose validity.
