# Rauawaawa Kaumātua Movement Game Prototype

## Live Demos

### 🎮 Movement Game Prototype

[Open Movement Game Prototype](https://harlanluo.github.io/Rauawaawa-demo/Rauawaawa_game_demo.html)

Interactive HTML prototype containing the Kaumātua exercise flow, Voice Guidance, and Staff prototype workflow.

### 📷 Camera Pose Tracking Demo

[Open Camera Pose Tracking Demo](https://harlanluo.github.io/Rauawaawa-demo/camera_pose_demo/camera_pose_test.html)

Standalone MediaPipe webcam pose tracking prototype.

The camera prototype is not yet integrated into the main game.

## Overview

This University of Waikato student project is an evolving prototype for a camera-based movement and exercise game intended for kaumātua. It explores simple movement and exercise interaction, an accessible user interface, a kaumātua exercise flow, a Staff content-management workflow, and camera-based movement tracking.

## Local Development and Testing

The live demo links above are the primary testing method. For local development, teammates with repository access can clone or download this repository, then run both prototypes from the repository root:

```bash
python -m http.server 8000
```

### Main Game Prototype

File: `Rauawaawa_game_demo.html`

Open `http://localhost:8000/Rauawaawa_game_demo.html` after starting the local server.

This is the main interactive prototype. It includes the Kaumātua exercise flow, Voice Guidance, a Staff login and management prototype, the exercise and game library, and the upload, record, simulated processing, and publishing flow. The Staff login and processing workflow are prototype-only and do not use a production backend.

### Camera Pose Tracking Demo

File: `camera_pose_demo/camera_pose_test.html`

Open `http://localhost:8000/camera_pose_demo/camera_pose_test.html` after starting the local server. Allow camera permission when prompted; Chrome or Edge is recommended. Internet access is required because the MediaPipe libraries and pose model are loaded from external URLs.

This is a separate technical prototype for real-time webcam pose and skeleton tracking. It is not yet integrated into the main movement game. Reference-video comparison, synchronisation, and final scoring are future work.

## Main UI Prototype

`Rauawaawa_game_demo.html` provides the main interface and interaction prototype. Kaumātua access does not require login. The prototype includes seated and standing selection, an exercise and game library, Voice Guidance, a Staff login, and a Staff management workflow for uploading or recording content, simulated processing, and publishing. Staff processing and backend behaviour are currently simulated in the browser.

## Camera Pose Tracking Prototype

`camera_pose_demo/` is a separate technical experiment. It includes webcam access, MediaPipe pose tracking, a real-time skeleton display, landmark visibility information, and six simple landmark-based pose targets.

The camera prototype is not yet integrated into the main game prototype. It does not provide reference-video pose extraction, pose similarity scoring, full game scoring, or Python processing integration.

## Accessibility and Design

The interface uses large controls, simple navigation, Voice Guidance, readable content, and Māori-inspired visual elements.

## Project Structure

- `Rauawaawa_game_demo.html` — main UI and interaction prototype
- `assets/` — visual assets used by the main prototype
- `camera_pose_demo/` — experimental webcam pose-tracking prototype

## Running the Main Prototype

The main HTML can be opened directly in a browser. It can also be served through localhost from the repository root:

```text
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/Rauawaawa_game_demo.html
```

## Running the Camera Pose Demo

Camera permissions and MediaPipe browser security work more reliably through localhost. From the repository root, run:

```text
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/camera_pose_demo/camera_pose_test.html
```

Internet access is currently required because the MediaPipe library, WASM runtime, and pose model are loaded from public CDN resources.

## Development Status

This repository represents an evolving university prototype. Future work may include extracting reference pose data from exercise videos, comparing player movement with reference pose data, adding simple and forgiving scoring, connecting the video-processing pipeline, and integrating webcam tracking into the main game.

## Team

Team Koru
