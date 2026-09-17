# Rauawaawa Kaumātua Movement Game Prototype

## Live Demos

### 🎮 Movement Game Prototype

[Open Movement Game Prototype](https://team-koru.netlify.app/)

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
- `js/avatar-pose-controller.js` — stable, simplified avatar pose feedback
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

## Project status

For current implementation status, completed features, known limitations, unfinished work, architecture, and planned next steps, see [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md).

`PROJECT_HANDOFF.md` should be updated whenever a major feature or PR is completed, before or together with merging that feature, so team members and AI tools have current project context.

## Player tracking

The main game tracks one player locally in the browser. Every game starts with the camera OFF, including Retry and Next Game. Entering a game does not load the model or request camera permission. The button below the avatar enables tracking and can cancel startup or turn the camera off. Turning it off, Finish, Quit, navigation, and page exit release camera tracks and stop processing. Pause stops processing; Resume only resumes an enabled camera. The model is reused between camera sessions.

The avatar shows five simplified states: neutral, left hand up, right hand up, both hands up, and arms open. Reliable shoulder/wrist landmarks must indicate a state for 200 ms before switching, with smooth arm transitions (disabled for reduced-motion preferences). The player's anatomical left moves the screen-left arm, like a mirror. Camera off, unavailable, no player, or unreliable landmarks return the avatar to neutral. Webcam frames are never recorded or uploaded, and the webcam image remains hidden.

Camera ON requests camera access first, attaches the hidden stream, and starts video playback before loading MediaPipe. While tracking loads the camera is ON and can be stopped. Camera-access errors and movement-tracking errors have separate messages; a tracking startup failure also releases the camera. Console warnings identify the failed stage and preserve the original exception. Diagnostics include `errorCategory` (`camera`, `tracking`, or `null`).

Live tracking uses MediaPipe Tasks Vision 1.0.1 with the official Pose Landmarker **Lite float16** model, ideal 640 × 480 camera input, and a 15 FPS inference cap. GPU is preferred, with CPU fallback if initialization fails. Camera failure leaves the demonstration video and game controls usable. Demonstration videos are **not analysed live**. Scoring remains unchanged; future scoring will use separately pre-generated reference-pose data. The standalone camera demo remains unchanged.

Modern Chrome / Edge desktop browsers are the current primary test target. Lower-powered devices use a lighter pose configuration and CPU fallback where needed. Smart TV browser support is not guaranteed; connecting a laptop or mini PC to a TV remains the safer deployment option.

For device tests, inspect `window.playerPoseTracking.getDiagnostics()` and `getLatestLandmarks()` in the browser console. Diagnostics include delegate, actual resolution, target/measured FPS, smoothed inference time, and lifecycle state. `?poseDelegate=cpu` forces CPU for testing; `?poseDebug=1` shows diagnostics (combine with `&poseDelegate=cpu`). No technical panel is shown by default, and neither mode shows a camera preview.

Run the controlled lifecycle tests with a recent Node.js version (no npm dependencies):

```bash
node --experimental-vm-modules --test --test-isolation=none tests/pose-tracker.test.cjs
```

These tests use mock camera/model inputs; real webcam permission, detection quality, performance, and the hardware camera indicator still need device testing.
