# Camera Pose Tracking Demo

A standalone technical prototype for the Rauawaawa movement game. It tests browser webcam input and real-time, single-person pose tracking with Google MediaPipe.

This demo is currently separate from the main game prototype and is not yet integrated into the Kaumātua exercise flow.

## Run the Demo Locally

GitHub Pages is not available for this private repository on the current plan. Clone or download the main repository, then run this command from its root:

```bash
python -m http.server 8000
```

Open:

```text
http://localhost:8000/camera_pose_demo/camera_pose_test.html
```

Allow camera permission when prompted. Chrome or Edge is recommended. The page requests video only and does not request microphone access. Internet access is required because the MediaPipe library, WASM runtime, and pose model are loaded from external CDN and model URLs.

## Features

- Start and stop the webcam safely
- Mirrored selfie-style camera preview
- Real-time MediaPipe Pose Landmarker skeleton overlay
- Single-person tracking with the Full pose model
- Visibility values for shoulders, elbows, wrists, and hips
- Six landmark-based pose targets with live card highlighting
- Stable pose confirmation with a short hold time and release grace period
- Helpful lower-body visibility feedback for knee targets
- Clear camera, model, person-detection, and error status messages
- Responsive desktop and tablet layout

## Pose targets

After starting the camera, the page can recognise these simple target poses:

- Both Arms Raised
- Arms Out to Sides
- Left Arm Raised
- Right Arm Raised
- Left Knee Raised
- Right Knee Raised

Hold a pose for about 600 milliseconds to confirm it. A confirmed pose remains visible through brief tracking jitter and is released after about 400 milliseconds without a matching frame. The preview is mirrored, but the Left and Right labels follow the person's anatomical left and right sides.

Knee targets require both hips and knees to be visible. They are intended only as technical landmark tests.

This prototype does not include scoring, percentage similarity, exercise-video comparison, recording, pose history, or backend services.

## Technology

- HTML, CSS, and JavaScript in one standalone file
- MediaPipe Tasks Vision `@mediapipe/tasks-vision` 1.0.1
- MediaPipe Pose Landmarker Full float16 model
- Browser `getUserMedia()` API

The MediaPipe package, WASM runtime, and pose model are loaded from public CDNs, so an internet connection is required.

## Browser notes

Modern desktop Chrome and Edge are the main test targets. Tablet performance and camera permissions depend on the device and browser. Pose inference runs in the browser and may use a CPU fallback when the GPU delegate is unavailable.
