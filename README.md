# Rauawaawa Kaumātua Movement Game Prototype

## Overview

This University of Waikato student project is an evolving prototype for a camera-based movement and exercise game intended for kaumātua. It explores simple movement and exercise interaction, an accessible user interface, a kaumātua exercise flow, a Staff content-management workflow, and camera-based movement tracking.

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
