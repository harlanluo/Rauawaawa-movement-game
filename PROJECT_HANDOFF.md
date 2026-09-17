# Rauawaawa Movement Game — Project Handoff

This document records the current technical state of the project. Repository code is the final source of truth if this document becomes stale.

## 1. Project overview

This is a University of Waikato project for Rauawaawa Kaumātua Charitable Trust. It is a browser-based movement and exercise game prototype for kaumātua. A player watches an exercise demonstration and follows the movement. The interface includes seated and standing exercise concepts.

Accessibility, simplicity, privacy, and Voice Guidance are important design concerns. The current repository is a prototype and does not claim final client approval, clinical validation, or production readiness.

## 2. Current architecture

### Reference side

```text
exercise video
  → offline MediaPipe preprocessing
  → reference-pose.json
  → stored with the game
```

### Player side

```text
hidden player webcam
  → live MediaPipe pose tracking
  → player landmarks
```

### Future scoring side

```text
reference pose + player pose
  → pose comparison
  → forgiving feedback / score
```

Architecture rules:

- Demonstration videos are not analysed live during gameplay.
- Reference analysis happens ahead of time and its result is stored as JSON.
- Only the player's camera needs live MediaPipe inference during gameplay.
- The webcam does not need to be visibly displayed to the player.
- Offline demonstration preprocessing and live player tracking must remain separate.

## 3. Important project files / structure

- `index.html` — all main prototype screens, game controls, the SVG avatar, and Staff prototype forms.
- `css/` — main application layout, visual design, responsive behavior, and avatar state styling.
- `js/app.js` — screen navigation, game/library state, video playback, Staff simulation, Voice Guidance, camera toggle, and tracker integration.
- `js/pose-tracker.js` — reusable live player-camera lifecycle and MediaPipe Pose Landmarker wrapper.
- `js/avatar-pose-controller.js` — maps reliable live landmarks to five stable prototype avatar states.
- `assets/videos/` — local exercise video assets. The current prototype has one real exercise video.
- `assets/games/demo-standing/reference-pose.json` — pre-generated reference landmarks and source/model/sampling metadata for the current video.
- `camera_pose_demo/` — older standalone camera pose demonstration, kept separate from the main game.
- `tools/reference-pose/` — offline extraction, sequence selection, validation, tests, and the developer visualizer.
- `PROJECT_HANDOFF.md` — living technical status, limitations, roadmap, and continuation guide.

## 4. Implemented functionality

### Main prototype

- Browser-based game/library interface.
- Local demonstration video playback with timeline, pause/resume, speed, fullscreen, finish, retry, and next-game flows.
- Seated and standing prototype categories.
- Six in-memory prototype game entries.
- Staff prototype screens for login, library editing, video selection/recording simulation, processing simulation, and publishing to the current browser session.
- Voice Guidance with spoken labels and subtitle feedback.

### Live player camera

- Camera is OFF by default for every game, retry, and next game.
- The player explicitly activates it with the Camera button.
- The webcam video element is hidden; frames are not recorded or uploaded by this code.
- Live tracking uses MediaPipe Tasks Vision 1.0.1 and the official Pose Landmarker Lite float16 model in VIDEO mode with one pose.
- Camera input requests an ideal 640 × 480 at up to 30 FPS; inference is capped at 15 FPS.
- GPU is preferred, with CPU fallback if GPU model initialization fails. `?poseDelegate=cpu` forces CPU for testing.
- Camera permission is requested and video playback begins before MediaPipe initialization.
- Pause stops inference scheduling. Resume restarts processing when the camera remains enabled.
- Turning the camera off, finishing, quitting, navigating away, or leaving the page releases tracks and clears player landmarks.
- Camera and tracking failures are reported separately and do not stop demonstration-video controls.
- Camera access requires localhost or HTTPS. Normal development through `file://` is unsupported.

### Current avatar

The avatar is a prototype, not a continuously articulated body. It supports five discrete states:

- `neutral`
- `leftHandUp`
- `rightHandUp`
- `bothHandsUp`
- `armsOpen`

Shoulder and wrist landmarks must be reliable and hold the same state for 200 ms before the display changes. Unreliable or missing landmarks reset the avatar to neutral.

### Reference preprocessing

- A standalone Python command runs offline, outside gameplay.
- It uses MediaPipe 0.10.32, the official Pose Landmarker Full float16 version 1 model, CPU, and VIDEO mode.
- It samples at 10 FPS by default and asks MediaPipe for up to four pose candidates.
- Each selected detection stores all 33 MediaPipe landmarks with x, y, z, and visibility.
- Missing or rejected samples are explicit `null` values; they are not interpolated.
- The JSON records source path and SHA-256, model identity and SHA-256, video metadata, decoder, sampling settings, coverage, and tracking settings.
- This tool is separate from the live game runtime and does not implement player comparison or scoring.

The current lower-resolution video produces 577 samples: 554 selected and 23 missing. Detection inside usable coverage is 96.01%. The longest missing sampled span is 1.2 seconds, from 24.6 to 25.8 seconds. The current replacement ends with exercise content and has no sustained black-tail range; the visualizer clears the overlay after the final matching sample.

### Reference continuity

- The exercise video may contain multiple demonstrators performing synchronized movements.
- Exact long-term person identity is not required. Stable exercise-pose continuity is the main goal.
- Hip-centered, torso-scale-normalized pose geometry is used to compare candidates while preserving left/right orientation and torso lean.
- Same-person continuity is a soft preference, not a rejection gate.
- Controlled switching to a compatible, reliable demonstrator is allowed and is preferred over an unnecessary null sample.
- Low-quality, incompatible, ambiguous, detector-empty, and sustained near-black samples may remain missing.
- The selector uses a bounded offline sequence search; it does not prove semantic exercise correctness.

### Reference visualizer

- `tools/reference-pose/visualizer.html` is a developer and QA page, not part of the normal kaumātua game UI.
- It overlays stored, pre-generated pose data on the source video.
- It does not import MediaPipe, load a pose model, or perform inference.
- Local: `http://localhost:8000/tools/reference-pose/visualizer.html`
- Netlify: `https://team-koru.netlify.app/tools/reference-pose/visualizer.html`

## 5. Current content situation

- There is currently only one real exercise video.
- It is standing exercise content.
- The six prototype games are labelled for both seated and standing categories but temporarily reuse this one physical video.
- Real seated exercise content has not yet been supplied.
- One physical source video should normally have one corresponding generated reference dataset. Do not create duplicate JSON files merely because multiple prototype game entries reuse that video.

## 6. Current limitations

- Gameplay score is fixed at 180.
- Player/reference pose comparison and movement-based scoring are not implemented.
- The avatar is a basic five-state prototype.
- Staff authentication, upload, recording, processing, and publishing are simulated or incomplete and disappear on refresh.
- There is no production backend, database, user account system, or durable content store.
- The current reference contains occasional short tracking gaps; the longest current sampled gap is 1.2 seconds.
- Controlled switching between synchronized people may occur.
- Side-facing arm landmarks can drift, especially during overlap or occlusion.
- Hands and feet can be inaccurate or jittery.
- The current video has no sustained black ending; it ends shortly after the last video frame while a slightly longer audio stream determines browser duration.
- Browser and device compatibility still needs broader validation.
- Smart-TV browser support is not guaranteed. A laptop or mini PC connected to a TV is the safer current option.
- Scoring thresholds have not been implemented or validated with users.

## 7. NOT IMPLEMENTED YET

- Pose comparison engine.
- Body-relative pose similarity.
- Good / Almost / Miss feedback.
- Temporal scoring tolerance.
- Real score accumulation.
- Replacement of the fixed score.
- Reference/player/video timeline integration.
- Continuous articulated avatar.
- Full Staff automated preprocessing flow.
- Publishing generated exercise video, metadata, and reference content.
- Real seated exercise dataset.
- Persistent backend and database.
- Final performance and device validation.
- Real kaumātua usability testing and scoring-threshold tuning.

## 8. Current roadmap

1. Build a pure, reusable pose-comparison engine.
2. Normalize reference and player pose geometry.
3. Compare major joint angles and important body features.
4. Handle visibility and missing data safely.
5. Produce forgiving similarity and structured feedback output.
6. Test comparison independently from the UI and camera.
7. Integrate the demonstration timeline, stored reference, and live player pose.
8. Replace the fixed prototype score with movement-based scoring.
9. Improve the avatar toward continuous articulated movement.
10. Build the Staff video-processing and publishing workflow.
11. Complete accessibility, performance, browser, device, and usability testing and polish.

These tasks can be split across team members. Some tracks can proceed in parallel when file ownership is clear and conflicts in core files such as `js/app.js` are coordinated.

## 9. Intended scoring principles

These are plans, not implemented features:

- Feedback should be forgiving rather than frame-perfect.
- Comparison should suit gentle movement and older users.
- Geometry should be normalized for body position and scale.
- Major joints should matter more than face, finger, or toe details.
- Comparison should be visibility-aware.
- Missing reference data must not penalize the player.
- Insufficient player-camera information should not automatically mean bad movement.
- Gameplay integration should use temporal tolerance instead of requiring one exact frame match.
- Thresholds are prototype values until tested with users, including kaumātua.

## 10. How to run the project

From the repository root:

```powershell
python -m http.server 8000
```

Open:

- Main game: `http://localhost:8000/`
- Reference visualizer: `http://localhost:8000/tools/reference-pose/visualizer.html`
- Netlify game: `https://team-koru.netlify.app/`
- Netlify visualizer: `https://team-koru.netlify.app/tools/reference-pose/visualizer.html`

Do not double-click `index.html` for normal development. Browser module loading, `fetch`, and camera security rules make `file://` unsupported. Use localhost during development and HTTPS when deployed.

## 11. How to generate reference pose data

Codex is not required. Any developer can run the preprocessing command locally.

The tool is tested with Python 3.12 on Windows. From the repository root:

```powershell
python -m venv tools/reference-pose/.venv
tools/reference-pose/.venv/Scripts/python -m pip install -r tools/reference-pose/requirements.txt
tools/reference-pose/.venv/Scripts/python tools/reference-pose/extract_reference_pose.py --input assets/videos/e9d87196a2d98e530ab1ddebd7c56c5e.mp4 --output assets/games/demo-standing/reference-pose.json --fps 10
```

On macOS or Linux, use `python3`, `.venv/bin/python`, and the same script arguments. `--input` and `--output` are required. `--fps` defaults to 10 and must not exceed the source FPS.

The first run downloads the official Pose Landmarker Full float16 version 1 model to `tools/reference-pose/pose_landmarker_full.task` and verifies its SHA-256. Later runs reuse the cached model. The virtual environment, model, caches, and optional debug candidate file are ignored by Git.

Validate and test after generation:

```powershell
tools/reference-pose/.venv/Scripts/python tools/reference-pose/validate_reference_pose.py assets/games/demo-standing/reference-pose.json
tools/reference-pose/.venv/Scripts/python -m unittest discover -s tools/reference-pose -p "test_*.py"
node --test --test-isolation=none tools/reference-pose/visualizer-data.test.mjs
python -m http.server 8000
```

Then inspect the full usable region at `http://localhost:8000/tools/reference-pose/visualizer.html`.

Whenever a physical source video changes or a new video is added:

1. Generate its reference JSON from that exact file.
2. Run the validator and tests.
3. Inspect alignment, gaps, switches, side-facing behavior, and the ending in the visualizer.

Never copy an old reference JSON to a new or modified video.

## 12. Git workflow

Use this sequence for major work:

```text
latest main
  → new feature branch
  → implement
  → test
  → update PROJECT_HANDOFF.md if project status changed
  → push
  → pull request
  → review
  → merge
  → next feature begins from fresh latest main
```

Major features should use separate branches and PRs. Do not continue unrelated work on an already merged feature branch. Before new work, fetch and inspect the latest `main`. Contributors should coordinate before editing the same core files, especially `index.html`, `css/styles.css`, and `js/app.js`.

## 13. Recent architecture-relevant PRs

### PR #8 — live camera and avatar tracking

Implemented the main-game Camera toggle, hidden player webcam, MediaPipe live tracker, lifecycle cleanup, GPU preference with CPU fallback, diagnostics, and stable five-state avatar feedback. It intentionally did not analyse the demonstration video, compare player and reference poses, or change the fixed score.

### PR #9 — Add exercise video reference pose extraction

Implemented the offline Python extraction pipeline, model/hash/source metadata, explicit missing samples, generated JSON, validator, and tests. It intentionally did not add visual QA, live gameplay analysis, player comparison, scoring, or Staff automation.

### PR #10 — Add reference pose visual QA tool

Implemented the separate stored-pose visualizer with sample navigation, missing-range reporting, and video overlay. It intentionally performs no MediaPipe inference and is not linked from the normal game UI.

### PR #11 — Stabilize reference pose continuity across synchronized demonstrators

Replaced strict single-person selection with movement-centered sequence selection across up to four candidates. Same-person continuity became a soft preference; compatible synchronized alternatives can fill gaps while unreliable or ambiguous samples remain null. The final cleanup also includes the lower-resolution replacement video, regenerated matching JSON, visualizer compatibility for the MP4's small audio/video duration difference, README links, and this handoff document. It intentionally does not implement gameplay scoring or player/reference comparison.

## 14. Suggested team work split

This is a suggested split, not a fixed assignment.

### Track A — Pose comparison / scoring

- Body-relative normalization.
- Joint-angle and important-geometry comparison.
- Visibility and missing-data handling.
- Pure-module unit tests and reference/player fixtures.

### Track B — Avatar

- Continuous shoulder, elbow, and wrist articulation.
- Stable mapping from live landmarks to avatar joints.
- Later lower-body articulation where camera framing supports it.

### Track C — Staff processing workflow

- Real video upload UX.
- Safe preprocessing invocation design.
- Exercise/game metadata.
- Generated asset validation and publishing workflow.

### Track D — Accessibility / UI / testing

- Voice Guidance review and expansion.
- Keyboard and screen-reader accessibility.
- Responsive behavior and legibility.
- Browser, device, camera, and performance testing.
- Seated/standing content and usability testing.

## 15. Using this file with AI

Team members can provide `PROJECT_HANDOFF.md` to ChatGPT, Codex, or another AI assistant and ask it to:

- Explain the current project.
- Separate implemented features from unfinished work.
- Recommend a suitable remaining task.
- Help design, implement, test, or review that task.

AI assistants should:

- Read the latest repository code as well as this document.
- Treat the latest repository code as the final source of truth when documentation is stale.
- Inspect the latest `main`, current branch, working tree, and relevant PR before changing files.
- Never assume planned features already exist.
- Preserve existing behavior unless the task explicitly changes it.
- Keep offline demonstration preprocessing separate from live gameplay.
- Never re-analyse the demonstration video live during gameplay.
- Never silently redesign the scoring architecture.
- Use a fresh branch for each new major feature after its prerequisite PR is merged.
- Report limitations, test scope, and missing evidence honestly.

## 16. Handoff maintenance rule

> **This document is a living project-status document. Whenever a major feature or PR is completed, update `PROJECT_HANDOFF.md` before or as part of merging that PR.**

At minimum, review and update:

- Implemented functionality.
- Current limitations.
- NOT IMPLEMENTED YET.
- Roadmap and immediate next task.
- Architecture, if it changed.
- Commands and development workflow, if they changed.

Minor typo and style-only changes do not require a handoff update.

## 17. Immediate next major task

With PR #11 merged, the immediate next major task is the **pose comparison / scoring engine**.

Input:

- Reference MediaPipe landmarks.
- Player MediaPipe landmarks.

Output:

- Normalized pose similarity.
- Structured, visibility-aware feedback suitable for later Good / Almost / Miss and scoring decisions.

Develop this first as a reusable pure comparison module with focused tests. Do not begin with gameplay integration. After the comparison behavior is understood and tested independently, connect it to the demonstration timeline, stored reference data, and live player landmarks.

## 18. Project continuation note

Remaining work is intended to be shared among team members. This document exists so contributors can independently understand the current system, choose a track, and continue development without repeated verbal project explanations.
