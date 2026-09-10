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

Allow camera permission for the camera prototype. Internet access is required because its MediaPipe library, runtime, and model load from public CDN resources.
