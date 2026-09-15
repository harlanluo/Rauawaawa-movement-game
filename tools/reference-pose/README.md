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

MediaPipe uses CPU, VIDEO mode, one pose, and explicit 0.5 detection/presence/tracking confidence settings. These are model inference settings, not scoring thresholds. See the [official Pose Landmarker API](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/PoseLandmarker).

## Format version 1

JSON contains:

- `formatVersion: 1`, `sourceVideo` (repository-root-relative for the command above), and source SHA-256.
- `poseModel`: profile, pinned URL, model SHA-256, MediaPipe version, delegate, mode, number of poses, inference settings.
- `video`: duration in milliseconds, decoded width/height, source FPS, decoded frame count.
- `sampling`: requested FPS, selection strategy, timestamp basis, decoder/version.
- `frames`: ordered `{timeMs, landmarks}` records. A detected pose has exactly 33 landmarks in standard MediaPipe order, each with `x`, `y`, `z`, and `visibility`. No detection is explicitly `landmarks: null`. Unavailable visibility is `null`; low visibility values are retained without filtering or inventing coordinates.

Coordinates are MediaPipe normalized image landmarks, unmirrored and untransformed. Values are not clamped: coordinates can extend outside the image, and z is relative depth, not a world-space distance. Body-relative normalization, joint angles, scale/torso alignment and temporal tolerance belong to later comparison work. No movement labels or scores are stored.

The decoder reads sequentially and selects the first frame at or after each zero-based sampling-grid time. Timestamps refer to selected source frames, rounded to integer milliseconds; sampling can differ from the target by up to one source frame. Output order is deterministic, but model inference is not promised to be bit-identical across hardware/library versions. Duration is decoded frame count / source FPS.

Supported inputs have constant frame rate, stable dimensions, and usable zero-based presentation timestamps. Variable/missing timing or incomplete decoding fails without replacing an existing output. Convert such input to constant frame rate separately before extraction; automatic conversion is out of scope. One-person exercise videos are intended: multi-person identity selection is not implemented. The tool stores samples in memory before writing a validated compact JSON atomically; very long videos may need a future streaming implementation.

## Validate

```powershell
python tools/reference-pose/validate_reference_pose.py assets/games/demo-standing/reference-pose.json
python -m unittest discover -s tools/reference-pose -p "test_*.py"
node -e "const d=JSON.parse(require('fs').readFileSync('assets/games/demo-standing/reference-pose.json','utf8')); console.log(d.formatVersion,d.frames.length)"
```

Validation checks version, metadata, finite coordinates, visibility, 33 landmarks, explicit missing poses, strictly increasing in-duration timestamps, target schedule and coverage through the end. The CLI reports duration, detected/missing counts, detected percentage, effective FPS, first/last timestamp, output bytes and runtime. A missing pose is valid output; detection percentage is not a measure of landmark accuracy.

Run the browser game with `python -m http.server 8000` and open `http://localhost:8000/`, or use HTTPS. Opening `index.html` with `file://` is unsupported. The extractor does not change live camera or avatar behaviour.

## Current real-video result

The command above processed the existing 1280 × 720 video: 2,196 decoded frames, 73,199.67 ms duration, and 732 samples at a requested 10 FPS (effective 10.00005 FPS). There are 564 detected poses (77.05%), each with 33 landmarks, and 168 explicit missing poses. First/last timestamps are 0 / 73,133 ms. The JSON is 1,975,203 bytes. The initial measured extraction took 15.45 seconds with the model already downloaded; runtime depends on hardware and excludes Python import time. No manual landmark-accuracy review or future scoring suitability is claimed.

## Visual QA

From the repository root run `python -m http.server 8000`, then open
`http://localhost:8000/tools/reference-pose/visualizer.html` (HTTP(S) required; `file://` shows instructions).
The separate development page displays the existing video and pre-generated JSON only. It does **not** load MediaPipe or a model, run inference, or change gameplay.

Use normal video controls, Previous/Next sample, a 0-based sample index, or Next missing sample (wraps to the first missing sample). Stepping pauses and seeks the video. Skeleton and points can be toggled separately. The QA panel reports timestamps, signed delta, detection and totals. Missing poses clear the canvas and show an amber message; clickable ranges group consecutive null samples. Range endpoints are first/last sampled timestamps, not estimated continuous detection-loss boundaries.

Matching uses binary search for the nearest timestamp, with ties choosing the earlier sample. Maximum distance is half the requested sample interval plus one source frame plus 1 ms for rounding (±84.3 ms for this dataset). Larger gaps show no match; no landmarks are interpolated. Drawing uses raw normalized coordinates and the standard [MediaPipe pose connections](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/python/solutions/pose_connections.py). Low-visibility points remain visible, so uncertain limbs can look inaccurate.

The page checks format, source path, timestamps, landmark values/count, and loaded video dimensions/duration. The video is fetched into browser memory as a blob so seeking works even with Python's basic server without byte-range support; no physical asset copy is created. Long videos need additional browser memory. This is an inline inspection tool: native video fullscreen/Picture-in-Picture is discouraged because it may omit the canvas. Metadata validation does not prove the video's byte identity (no source-hash comparison).

Run focused tests with `node --test --test-isolation=none tools/reference-pose/visualizer-data.test.mjs` in addition to the extraction and camera tests.

### Real-data inspection findings

Browser spot checks at 0, 18.333, 36.633, 54.933 and 72.033 seconds found no obvious global coordinate offset or mirroring. However, the multi-person video alternates the stored single pose between front-left and front-right people. Some arm landmarks drift from the visible arm during side-facing movement; these are raw data limitations, not corrected by the viewer. This is a spot check, not an accuracy certification or confirmation of scoring suitability.

Missing ranges are 15.233–16.233 s (11 samples), 29.233 s (1), 37.233 s (1), and 57.733–73.133 s (155). All four range starts were inspected: people remain visible at the three earlier missing sections; the longest range begins on a black frame, and the near-end check is also black. The longest sampled span is 15.400 seconds. No missing data or source assets were changed.
