# Rauawaawa Kaumātua Movement Game Prototype

## Live Demos

### 🎮 Movement Game Prototype

Online demo link will be updated soon.

### 📷 Camera Pose Tracking Demo

[Open Camera Pose Tracking Demo](https://harlanluo.github.io/camera_pose_demo/camera_pose_test.html)

Standalone MediaPipe webcam pose-tracking prototype.

## Overview

This University of Waikato student project is an evolving prototype for a camera-based movement and exercise game intended for kaumātua. It explores accessible exercise flows, simple game interaction, Staff content management, and browser-based movement tracking.

## Main Prototype

Main file: `Rauawaawa_movement_game.html`

The main prototype provides a simple kaumātua-facing Start Game flow with Seated and Standing modes, a game library, and synchronized Voice Guidance. It also includes a prototype-only Staff login and management flow for uploading or recording video, simulated processing, and publishing games during the browser session.

## Camera Pose Tracking Prototype

The separate `camera_pose_demo/` prototype uses webcam access and MediaPipe Pose Landmarker for real-time skeleton tracking and landmark debug information. It includes six basic pose targets: both arms raised, arms out to the sides, left arm raised, right arm raised, left knee raised, and right knee raised.

The camera prototype is still separate from the main movement game and does not yet provide reference-video comparison or final game scoring.

## Running Locally

From the repository root, run:

```bash
python -m http.server 8000
```

Then open:

- Main prototype: `http://localhost:8000/Rauawaawa_movement_game.html`
- Camera prototype: `http://localhost:8000/camera_pose_demo/camera_pose_test.html`

Allow camera permission for the camera prototype. Internet access is required because its MediaPipe library, runtime, and model load from public CDN resources.
