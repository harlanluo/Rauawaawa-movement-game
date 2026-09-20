# Rauawaawa Kaumātua Movement Game Prototype

## Live Demos

### 🎮 Movement Game Prototype

[Open Movement Game Prototype](https://team-koru.netlify.app/)

### 🦴 Reference Pose Visualizer

[Open Reference Pose Visualizer](https://team-koru.netlify.app/tools/reference-pose/visualizer.html)

### 📷 Camera Pose Tracking Demo

[Open Camera Pose Tracking Demo](https://team-koru.netlify.app/camera_pose_demo/camera_pose_test.html)

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

## Pose comparison

`js/pose-comparison.js` provides a reusable pure comparison module. It normalizes reference and player landmarks around the hips/torso, compares major arm, leg, hand, foot, and torso features, skips low-visibility features, and returns a structured result with `similarity`, `rating`, and sorted feedback. Missing reference samples are skipped, and insufficient player-camera information is reported separately from bad movement.

`js/pose-scoring.js` connects comparison to the stored reference timeline. During gameplay it searches within 300 ms of the demonstration time, uses the best valid comparison in that window, and keeps the best result in each 500 ms scoring segment. Each valid segment adds up to 10 points, so the visible game score only increases; average similarity remains available in the scoring summary for diagnostics. Reference gaps, camera-off time, and insufficient player visibility do not add a score sample. Good / Almost / Keep moving feedback appears below the avatar. These timings and thresholds are prototype values and still require representative user testing.

The selected play mode changes the body requirements. Seated mode normalizes around the shoulders and scores upper-body joints without requiring hips or legs in frame. Standing mode uses shoulder and hip anchors and includes lower-body features when reliable.

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
node --experimental-vm-modules --test --test-isolation=none tests/pose-comparison.test.mjs tests/pose-scoring.test.mjs tests/pose-tracker.test.cjs
```

These tests use mock camera/model inputs; real webcam permission, detection quality, performance, and the hardware camera indicator still need device testing.
