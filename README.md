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
- `assets/images/` — project image assets
- `assets/videos/` — exercise and game video assets
- `camera_pose_demo/` — standalone MediaPipe camera prototype

## Running Locally

From the repository root, run:

```bash
python -m http.server 8000
```

Then open:

- Main prototype: `http://localhost:8000/`
- Camera prototype: `http://localhost:8000/camera_pose_demo/camera_pose_test.html`

Allow camera permission when starting a game (or using the camera prototype). Use localhost or HTTPS. Internet access is required for the public CDN library, runtime, and model.

## Player tracking

The main game now tracks one player locally in the browser. Webcam frames are never recorded or uploaded, and the webcam image remains hidden while the virtual avatar stays visible. The tracker loads on game start and reuses its model between games. Pause stops processing; Finish, Quit, navigation, and page exit release the camera.

Live tracking uses MediaPipe Tasks Vision 1.0.1 with the official Pose Landmarker **Lite float16** model, ideal 640 × 480 camera input, and a 15 FPS inference cap. GPU is preferred, with CPU fallback if initialization fails. Camera failure leaves the demonstration video and game controls usable. Demonstration videos are **not analysed live**. Scoring remains unchanged; future scoring will use separately pre-generated reference-pose data. The standalone camera demo remains unchanged.

Modern Chrome / Edge desktop browsers are the current primary test target. Lower-powered devices use a lighter pose configuration and CPU fallback where needed. Smart TV browser support is not guaranteed; connecting a laptop or mini PC to a TV remains the safer deployment option.

For device tests, inspect `window.playerPoseTracking.getDiagnostics()` and `getLatestLandmarks()` in the browser console. Diagnostics include delegate, actual resolution, target/measured FPS, smoothed inference time, and lifecycle state. `?poseDelegate=cpu` forces CPU for testing; `?poseDebug=1` shows diagnostics (combine with `&poseDelegate=cpu`). No technical panel is shown by default, and neither mode shows a camera preview.

Run the controlled lifecycle tests with a recent Node.js version (no npm dependencies):

```bash
node --experimental-vm-modules --test --test-isolation=none tests/pose-tracker.test.cjs
```

These tests use mock camera/model inputs; real webcam permission, detection quality, performance, and the hardware camera indicator still need device testing.
