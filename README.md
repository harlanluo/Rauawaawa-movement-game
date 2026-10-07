# Kaumātua Movement Game Prototype

## Live Demos

### 🎮 Movement Game Prototype

[Open Movement Game Prototype](https://teamkoru.netlify.app/)

### 🦴 Reference Pose Visualizer

[Open Reference Pose Visualizer](https://teamkoru.netlify.app/tools/reference-pose/visualizer.html)

### 📷 Camera Pose Tracking Demo

[Open Camera Pose Tracking Demo](https://teamkoru.netlify.app/camera_pose_demo/camera_pose_test.html)

The MediaPipe camera prototype remains separate from the main movement game and does not yet provide reference-video comparison or final game scoring.

## Overview

This University of Waikato student project is an evolving prototype for a camera-based movement and exercise game intended for kaumātua. It explores accessible exercise flows, simple game interaction, Staff content management, and browser-based movement tracking.

## Project Structure

- `index.html` — main movement game application page
- `css/styles.css` — main application styling
- `js/app.js` — main application behaviour
- `js/pose-tracker.js` — reusable live player-camera tracker
- `js/avatar-pose-controller.js` — smoothed, continuously articulated avatar feedback
- `js/pose-comparison.js` — pure reference/player pose comparison helpers
- `js/pose-scoring.js` — reference timeline matching and gameplay score aggregation
- `assets/images/` — project image assets
- `assets/videos/` — exercise and game video assets
- `camera_pose_demo/` — standalone MediaPipe camera prototype
- `tools/reference-pose/` — offline reference extraction and developer QA tools
- `PROJECT_HANDOFF.md` — current technical status and continuation guide

## Running Locally

From the repository root, run:

```bash
python -m http.server 8000
```

Then open:

- Main prototype: `http://localhost:8000/`
- Camera prototype: `http://localhost:8000/camera_pose_demo/camera_pose_test.html`
- Reference pose visualizer: `http://localhost:8000/tools/reference-pose/visualizer.html`

Use the Camera button below the avatar to turn tracking on, then allow camera permission. Use localhost or HTTPS. Internet access is required for the public CDN library, runtime, and model.

Opening `index.html` directly with `file://` is unsupported because browser module and camera restrictions can prevent tracking from working.

## Reference pose preprocessing

Use the separate [Python extraction tool](tools/reference-pose/README.md) to generate reference landmarks ahead of gameplay. One dataset in `assets/games/demo-standing/reference-pose.json` references the existing shared video. The tool defaults to Full float16 at 10 samples per second; it does not run in the game or implement scoring.

## Reference pose visualizer

The [reference pose visualizer](https://team-koru.netlify.app/tools/reference-pose/visualizer.html) is a developer and QA tool. It displays the pre-generated reference landmarks over the source video and does not run MediaPipe inference itself. Run it locally at `http://localhost:8000/tools/reference-pose/visualizer.html`.

## Player layout, language and seeking

Each game, Retry and Next Game starts in the existing video-only Full Screen layout with Camera OFF. Show User Avatar restores the avatar; Full Screen hides it again without touching Camera or score. The single Camera control sits immediately after Start / Pause / Resume in the bottom bar. Starting requests permission only after explicit activation (two clicks with Voice Guidance ON); Cancel Camera Start cancels preparation. Camera can be prepared before Start without starting the exercise or awarding points.

Player controls and messages use `js/player-language.js` and `js/player-language-resources.js`. English is the default written interface. The bilingual English / Māori button directly below Voice Guidance selects one written language on all player pages. Māori selection enables candidate wording for feature review without approving it; ordinary labels use one language. The session preference survives navigation, Retry and Next Game; refresh resets to English. Written language and spoken guidance are independent. Staff remains English. Optional `nameMi` and `descriptionMi` metadata is displayed only with `languageApproval: 'approved'`; source content stays intact otherwise. See [the review inventory](docs/player-language-review.md) for wording, scripts and approval gaps.

Voice Guidance opens an English / Māori selection dialog, and reopens it for changes while ON. Controls and reselection choices use first-click speech, second-click confirmation. Close/Escape preserves the previous state; Turn Voice Guidance Off disables it explicitly. No approved Māori voice or recordings were supplied, so Māori selection explains the limitation and offers an explicit English choice. Device language tags are not pronunciation approval.

Seeking suspends scoring and invalidates pending poses/comparison feedback while preserving the best result for every 500 ms checkpoint. Native seeks, pointer dragging and keyboard changes share the same protection; fresh post-seek capture context is required. Forward seeks do not fill skipped checkpoints, replay improves only an existing checkpoint's best, and paused seeking never starts playback. Finish/Quit/Retry/Next isolate sessions and camera callbacks.

## Pose comparison

`js/pose-comparison.js` provides a reusable pure comparison module. It normalizes reference and player landmarks around the hips/torso, compares major arm, leg, hand, foot, and torso features, skips low-visibility features, and returns a structured result with `similarity`, `rating`, and sorted feedback. Missing reference samples are skipped, and insufficient player-camera information is reported separately from bad movement.

`js/pose-scoring.js` connects comparison to the stored reference timeline. During gameplay it searches within 300 ms of the demonstration time, uses the best valid comparison in that window, and keeps the best result in each 500 ms scoring segment. Each valid segment adds up to 10 points, so the visible game score only increases; average similarity remains available in the scoring summary for diagnostics. Reference gaps, camera-off time, and insufficient player visibility do not add a score sample. Movement and tracking nodes remain visually hidden without layout space or routine live announcements. Actual camera failures appear beside the bottom Camera control. The video-only stage is centered, capped at 1200px and constrained by available height, with proportional contained video; avatar mode retains the split layout. These timings and thresholds are prototype values and still require representative user testing.

The selected play mode changes the body requirements. Seated mode normalizes around the shoulders and scores upper-body joints without requiring hips or legs in frame. Standing mode uses shoulder and hip anchors and includes lower-body features when reliable.

To inspect the comparison algorithm, open `http://localhost:8000/tools/pose-comparison/visualizer.html`. It plays the stored reference timeline beside either a controllable simulated pose or live local camera tracking, exposes seated/standing behavior, and shows the overall and per-feature similarity results returned by the gameplay engine.

## Project status

For current implementation status, completed features, known limitations, unfinished work, architecture, and planned next steps, see [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md).

`PROJECT_HANDOFF.md` should be updated whenever a major feature or PR is completed, before or together with merging that feature, so team members and AI tools have current project context.

## Player tracking

The main game tracks one player locally in the browser. Every game starts with the camera OFF, including Retry and Next Game. Entering a game does not load the model or request camera permission. The button below the avatar enables tracking and can cancel startup or turn the camera off. Turning it off, Finish, Quit, navigation, and page exit release camera tracks and stop processing. Pause stops processing; Resume only resumes an enabled camera. The model is reused between camera sessions.

The avatar continuously maps reliable shoulder, elbow, wrist, hip, knee, and ankle landmarks to an articulated mirrored figure. Landmark coordinates are body-relative and smoothed to reduce camera jitter. The earlier neutral, left-hand-up, right-hand-up, both-hands-up, and arms-open labels remain available internally for compatibility, but the displayed limbs are no longer limited to those states. Seated mode needs reliable shoulders and animates the upper body; Standing mode requires reliable shoulders and hips for a stable full-body figure. Missing optional joints fade only their affected limb segments. Webcam frames are never recorded or uploaded, and the webcam image remains hidden during normal gameplay.

Camera ON requests camera access first, attaches the hidden stream, and starts video playback before loading MediaPipe. While tracking loads the camera is ON and can be stopped. Camera-access errors and movement-tracking errors have separate messages; a tracking startup failure also releases the camera. Console warnings identify the failed stage and preserve the original exception. Diagnostics include `errorCategory` (`camera`, `tracking`, or `null`).

Live tracking uses MediaPipe Tasks Vision 1.0.1 with the official Pose Landmarker **Lite float16** model, ideal 640 × 480 camera input, and a 15 FPS inference cap. GPU is preferred, with CPU fallback if initialization fails. Camera failure leaves the demonstration video and game controls usable. Demonstration videos are **not analysed live**; scoring uses separately pre-generated reference-pose data. The standalone camera demo remains unchanged.

Modern Chrome / Edge desktop browsers are the current primary test target. Lower-powered devices use a lighter pose configuration and CPU fallback where needed. Smart TV browser support is not guaranteed; connecting a laptop or mini PC to a TV remains the safer deployment option.

For device tests, inspect `window.playerPoseTracking.getDiagnostics()` and `getLatestLandmarks()` in the browser console. Diagnostics include delegate, actual resolution, target/measured FPS, smoothed inference time, and lifecycle state. `?poseDelegate=cpu` forces CPU for testing. `?poseDebug=1` shows diagnostics and a developer-only button for a mirrored local camera/skeleton preview (combine with `&poseDelegate=cpu`). No technical panel or camera preview is shown by default.

Run the controlled lifecycle tests with a recent Node.js version (no npm dependencies):

```bash
node --experimental-vm-modules --test --test-isolation=none tests/pose-comparison.test.mjs tests/pose-scoring.test.mjs tests/pose-tracker.test.cjs tests/player-language.test.cjs
```

These tests use mock camera/model inputs; real webcam permission, detection quality, performance, and the hardware camera indicator still need device testing.


## Optional Python backend

Use the Python extraction environment for the integrated upload preview:

```powershell
python -m venv tools/reference-pose/.venv
tools/reference-pose/.venv/Scripts/python -m pip install -r tools/reference-pose/requirements.txt
tools/reference-pose/.venv/Scripts/python tools/local_server.py
```

Open `http://127.0.0.1:8001/?libraryBackend=local` in Chrome or Edge to use the optional Python backend. Staff demo login is `staff` / `123`. Choose Add New Game → Upload Video, then Continue to Processing. The original video is sent only to the loopback server for the existing Python extraction algorithm; the browser simultaneously runs Josten's stylizer. Publish becomes available when both the MP4 and reference JSON are ready. Newly published games use their own movement reference for scoring. First extraction downloads the verified official Full pose model.

The video stylizer outputs the first 60 seconds, at 15 FPS and up to 640 pixels wide. Reference sampling stays at 10 FPS with original timestamps and is restricted to that same first 60 seconds. Uploads are limited to 200 MB and one extraction at a time. The Python tool requires constant-frame-rate input; errors remain visible instead of publishing an unscored game. Cancel or navigation stops extraction. Temporary original files are removed after extraction; games and object URLs remain only for the current browser session. Staff recording uses the device camera, with optional microphone audio, a 60-second cap, preview/retake/download, and MP4 normalization before processing. The optional Python backend provides an extraction API; the default browser mode also works with plain static hosting.

Run API contract tests with `python -m unittest discover -s tests -p test_local_server.py`.


Staff Record Video requests camera permission only when Start Recording is pressed. Microphone audio is opt-in. Stop, Retake, navigation and page exit release the camera. Completed recordings are previewable and downloadable, then Continue uses the same character conversion and movement-reference pipeline as uploads. Preparing the MP4 requires the CDN media library and Chrome/Edge WebCodecs. Tests: `node --test tests/video-recorder.test.mjs`.


Choose Seated or Standing before processing an upload or recording. Seated reference extraction uses shoulder-centered, shoulder-width normalization and reliable shoulder/arm joints, without requiring visible hips or legs. Standing retains its full-body quality requirements. Publication keeps the selected mode so the reference and player scoring agree. Record duration can be shorter than 60 seconds.


## Persistent local library

Staff → Library Settings lets you configure an absolute local folder path. The default is `<repository>/local-games`; the selection persists in ignored `local-settings.json`. Saving a game writes only `video.mp4`, `reference-pose.json` and `game.json` into a numeric game subfolder. Page startup reads `/api/games` from disk. Editing a saved game updates its metadata; deletion moves its folder into `.trash` for recovery. Switching libraries loads the target folder without moving or removing previous files. For the optional Python backend use port 8001 with `?libraryBackend=local`. Default browser mode uses a user-authorized directory handle on static hosting. Older session-only games must be downloaded/reprocessed before refreshing the old page.


## Browser-only workflow (default; Netlify compatible)

The default app no longer calls Python APIs. Serve the existing static files over HTTPS (Netlify) or localhost, using desktop Chrome/Edge. Staff → Game Library → Settings → Choose Folder grants access to a local library. Save and Load Library reconnects the handle if permission is required. The folder handle is stored in IndexedDB for this browser/profile/origin; the browser exposes its name, not its absolute path. Choosing a folder on localhost does not grant the Netlify origin access: choose it once there too. Browsers without File System Access support display a clear error.

Movement reference extraction runs MediaPipe Full in the browser at 10 FPS, sampling the first 60 seconds through Mediabunny/WebCodecs. It supports seated upper-body and standing full-body modes. The browser selector uses a deterministic greedy continuity rule with explicit gaps and ambiguity rejection; it is not identical to the Python tool's bounded offline Viterbi search. Validate multi-person content before use. Model/library downloads still need internet access. Conversion continues to use Josten's unchanged segmentation pipeline.

Only converted video, reference JSON and game metadata are saved to the selected folder. Existing Python libraries are readable. Editing changes folder names; deleting copies the three game files into `.trash` before removal. Unrelated files are left in place. No raw footage is persisted, and processing does not upload the video.

To use the old Python backend explicitly, add `?libraryBackend=local` on port 8001. No backend is required for the default Netlify workflow. Run browser workflow tests with `node --test tests/browser-workflow.test.mjs`.

API references: [Chrome File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access) and [MediaPipe Pose Landmarker for Web](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js).
