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

### Scoring side

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
- `js/avatar-pose-controller.js` — maps reliable live landmarks to a smoothed, continuously articulated avatar.
- `js/pose-comparison.js` — pure reference/player pose normalization and similarity helpers.
- `js/pose-scoring.js` — temporal reference-frame selection and gameplay score aggregation.
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

- The SVG avatar continuously maps shoulder, elbow, wrist, hip, knee, and ankle landmarks into body-relative screen coordinates.
- Anatomical left appears on screen-left like a mirror.
- Coordinate smoothing reduces camera jitter without limiting movement to named poses.
- Seated mode uses shoulder-centered upper-body articulation. Standing mode requires shoulder and hip anchors for the full-body figure; missing optional joints fade only their affected segments.
- The earlier `neutral`, `leftHandUp`, `rightHandUp`, `bothHandsUp`, and `armsOpen` labels remain as stable internal compatibility states.
- Normal gameplay keeps the webcam hidden. `?poseDebug=1` exposes a developer-only toggle that draws the mirrored local camera and reliable pose connections on a canvas; frames are not saved or uploaded.

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

### Pose comparison and gameplay scoring

- `js/pose-comparison.js` is a pure JavaScript module used by the gameplay scoring session.
- It accepts reference MediaPipe landmarks and player MediaPipe landmarks.
- It normalizes poses around the hip center using torso/body scale so camera framing and body size differences matter less.
- It compares major arm, leg, hand, foot, shoulder-line, and torso-lean features.
- It skips low-visibility or missing features instead of treating them as bad movement.
- Missing reference samples return `rating: "skipped"` so stored reference gaps do not penalize the player.
- Insufficient player-camera information returns `rating: "insufficient"` separately from `good`, `almost`, or `miss`.
- It returns structured feedback sorted from weakest to strongest feature for gameplay feedback and scoring.
- `js/pose-scoring.js` selects stored reference frames within 300 ms of the current demonstration time and uses the best valid comparison in that window.
- Scoring is divided into 500 ms video-time segments. Repeated inference in a segment keeps its best valid similarity, so inference rate and brief jitter do not multiply or immediately reduce the score.
- Each valid segment adds up to 10 points to the visible score, so earned points never decrease. The average similarity remains available in the session summary for diagnostics.
- Seated mode uses shoulder-centered normalization and upper-body features; hips and legs are not required.
- Standing mode requires shoulder and hip anchors and includes reliable lower-body features.
- The UI reports Good, Almost, Keep moving, insufficient visibility, and temporary reference-gap states below the avatar.
- Camera-off time, missing reference windows, and insufficient player visibility do not add score samples.
- Reference JSON is loaded once and cached in the browser; the demonstration video is still not analysed live.
- `tools/pose-comparison/visualizer.html` demonstrates the gameplay comparison engine with the stored reference timeline and either a controllable simulated pose or the same live local camera tracker used by the game. It shows framing normalization, body-mode requirements, overall similarity, and per-feature scores.

## 5. Current content situation

- There is currently only one real exercise video.
- It is standing exercise content.
- The six prototype games are labelled for both seated and standing categories but temporarily reuse this one physical video.
- Real seated exercise content has not yet been supplied.
- One physical source video should normally have one corresponding generated reference dataset. Do not create duplicate JSON files merely because multiple prototype game entries reuse that video.

## 6. Current limitations

- Gameplay scoring is a first prototype and has not been calibrated with representative players or kaumātua.
- The 300 ms tolerance, 500 ms score interval, feature weights, and Good / Almost / Miss thresholds are provisional.
- Only the current shared demonstration video has a real matching reference dataset.
- The articulated avatar is still a visual prototype and needs real-device jitter, framing, and accessibility validation.
- Staff authentication, upload, recording, processing, and publishing are simulated or incomplete and disappear on refresh.
- There is no production backend, database, user account system, or durable content store.
- The current reference contains occasional short tracking gaps; the longest current sampled gap is 1.2 seconds.
- Controlled switching between synchronized people may occur.
- Side-facing arm landmarks can drift, especially during overlap or occlusion.
- Hands and feet can be inaccurate or jittery.
- The current video has no sustained black ending; it ends shortly after the last video frame while a slightly longer audio stream determines browser duration.
- Browser and device compatibility still needs broader validation.
- Smart-TV browser support is not guaranteed. A laptop or mini PC connected to a TV is the safer current option.
- Scoring thresholds have not been validated with users.

## 7. NOT IMPLEMENTED YET

- Representative threshold tuning for body-relative pose similarity.
- Representative validation and tuning of gameplay feedback and scoring.
- Per-exercise scoring profiles or clinically reviewed movement criteria.
- Production-quality avatar art and behavior validation.
- Full Staff automated preprocessing flow.
- Publishing generated exercise video, metadata, and reference content.
- Real seated exercise dataset.
- Persistent backend and database.
- Final performance and device validation.
- Real kaumātua usability testing and scoring-threshold tuning.

## 8. Current roadmap

1. Review and tune comparison thresholds, temporal tolerance, and score aggregation with representative player fixtures.
2. Validate camera scoring on real devices and with representative users, including kaumātua.
3. Validate and polish the articulated avatar on representative devices and movements.
4. Build the Staff video-processing and publishing workflow.
5. Complete accessibility, performance, browser, device, and usability testing and polish.

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

Run the JavaScript comparison, scoring, tracker, and application lifecycle tests with:

```powershell
node --experimental-vm-modules --test --test-isolation=none tests/pose-comparison.test.mjs tests/pose-scoring.test.mjs tests/pose-tracker.test.cjs
```

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

- Tune comparison thresholds and temporal tolerance with representative fixtures.
- Validate the 0-100 score and feedback language with representative users.
- Add per-exercise scoring configuration when more real exercise content is available.

### Track B — Avatar

- Validate continuous upper- and lower-body articulation across camera placements.
- Tune coordinate smoothing and missing-joint behavior with real players.
- Replace prototype geometry with production-quality avatar art when the visual direction is approved.

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

With gameplay scoring connected end to end, the immediate next major task is **representative scoring validation and tuning**.

Use recorded fixtures and real-device sessions to check the comparison thresholds, 300 ms temporal window, 500 ms score segments, feedback stability, mirrored movement expectations, and final 0-100 score. Include standing and, when real content becomes available, seated movements. Keep offline demonstration preprocessing separate from live player tracking, and do not analyse the demonstration video live during gameplay.

## 18. Project continuation note

Remaining work is intended to be shared among team members. This document exists so contributors can independently understand the current system, choose a track, and continue development without repeated verbal project explanations.


## Local video stylizer integration (2026-10-05)

Josten's `origin/feature/video_style` modules are integrated into Staff Upload Video → Processing → Publish. The embedded same-origin stylizer receives the selected File, displays live frame previews, and returns an MP4 Blob. Publishing assigns its object URL to the game, so gameplay uses the converted video. Navigating away unloads the processing iframe. Standalone `video_style/` remains available for downloads.

Processing requires Chrome/Edge, network access for library/model downloads, and uses Josten's existing 60-second, 15-FPS, 640-pixel limits. The transformation is multiclass segmentation into red/blue silhouettes over a beach image. Uploaded games now receive their own reference-pose dataset from the local extraction API; the default video's reference data is never reused for them. Games and output URLs exist only in the current page session. Record Video remains simulated.

Validation: 9 video stylizer tests and 29 existing pose/scoring/tracker tests passed; JavaScript syntax checks passed. Real-video conversion and uploaded movement extraction were subsequently verified together in the local browser.


### Uploaded movement scoring (2026-10-05)

`tools/local_server.py` serves the game on loopback port 8001 and provides asynchronous POST/GET/DELETE `/api/reference-pose` jobs. It invokes the existing extractor using the server Python interpreter; start it with the reference-pose virtual environment. The original uploaded File is processed by Python while the embedded stylizer runs independently in the browser. The publish button waits for both outputs, and new games point to their own reference JSON Blob URL. Original timestamps are preserved and samples are capped to the stylizer's first 60 seconds. Cancellation terminates the extractor subprocess. Non-local origins are rejected, inference concurrency is limited to one, and temporary uploads are deleted. This API is local-preview functionality and is not supported by static Netlify hosting.

Validation: 38 JavaScript tests, 21 Python extraction/selection tests, and 4 HTTP API contract tests passed. A fresh real extraction of the existing exercise video generated 577 samples, 554 with poses (96.01%).

Browser integration verification: the existing 57.7-second video produced 865 stylized frames with AAC audio copied; the movement guide completed and the publish button unlocked. The generated game appeared in the session library. Webcam-based live scoring still requires camera testing.


### Real Staff recording (2026-10-05)

Replaced the simulated Staff recorder with `js/video-recorder.js`: explicit camera start, optional microphone (off by default), hidden-until-start live preview, elapsed timer, 60-second automatic stop, recorded preview, retake and download. MediaRecorder captures WebM or MP4; Mediabunny/WebCodecs normalizes it to fixed 15-FPS MP4 before assigning it as the input File for the existing extraction/stylization flow. This avoids the Python extractor rejecting variable camera timestamps. Leaving, retake and page exit invalidate pending operations and stop tracks; late permission grants are released. Live gameplay camera behavior is unchanged.

Validation: 4 mocked recorder lifecycle/permission tests and 24 related tracking/stylizer tests passed. Real device permission, recording quality and browser transcoding require manual webcam testing.


### Mode-aware uploaded and recorded reference extraction (2026-10-05)

Upload and Record screens now offer Seated/Standing before processing. The local API validates `X-Body-Mode` and passes `--body-mode` to the Python extractor. Seated selection uses shoulders as anchors, shoulder width as scale, six shoulder/elbow/wrist joints for quality, and at least four reliable shared upper-body joints for continuity. Hips and legs are not part of seated quality or continuity; standing defaults are preserved. Metadata records mode and normalization. Publish locks the mode to the one used during extraction. Empty-result errors now describe this clip and mode-specific framing instead of saying "first 60 seconds".

Validation: 24 Python selection/validation tests, 4 API tests (including seated header propagation), and 33 scoring/tracker/recorder JavaScript tests passed. New tests cover missing hips/legs, shoulder/arm quality rejection, and seated framing invariance. Local server restarted on port 8001.


### Manual game start (2026-10-05)

Entering any game, Retry or Next now opens a paused preparation screen at time zero with a Start button. Players can position themselves and optionally enable the camera before playback and pose inference/scoring resume on Start. Later pauses still use Resume. Lifecycle tests assert that preparation schedules no inference callbacks and Start resumes the enabled camera.


### Configurable persistent local library (2026-10-05)

`tools/local_server.py` now exposes GET/POST `/api/settings`, GET/POST `/api/games`, and POST/DELETE `/api/games/<id>`. Default storage is ignored `local-games/`, configured path is persisted in ignored `local-settings.json`. Publishing stores original/converted MP4, reference JSON and metadata in a complete staged folder before committing it. Saved games are discovered from disk at page startup; editing is persisted and deleting moves the folder to a hidden `.trash`. The stable `/local-games/` URL maps to the configured folder even outside the checkout, with path traversal rejected. Staff dashboard includes Library Settings with the current path and save/load feedback. Switching directories leaves old files in place. Built-in prototype games still remain in memory; newly published games are persistent.

Validation: 6 HTTP tests passed, including saving, fresh disk listing, serving the saved video, editing, recoverable deletion, folder switching and config persistence; 15 tracking lifecycle tests passed. Browser verification confirmed path saving and reload success for the default folder. Current pre-update browser games are not automatically migrated.


Staff library settings now includes Choose Folder. Its same-origin local endpoint opens a native Windows FolderBrowserDialog via a fixed PowerShell script; the current folder is passed through an environment variable. Selection fills the field, cancellation leaves it unchanged, and Save and Load applies it separately. Concurrent picker requests are rejected. Seven local API tests passed, including selection/cancel and origin checks.


Privacy update (2026-10-05): published libraries no longer store original footage. The frontend omits the original file from publication requests and the backend ignores legacy original payloads. Only converted video, reference data and metadata remain. One existing original.mp4 was removed from the configured library, including a scan of hidden trash folders. Extraction still uses a temporary input file, deleted when the extraction job exits. Seven API tests passed, including no-original persistence.


Library folders now use game names instead of numeric IDs. Windows-invalid characters are replaced, reserved names are prefixed, duplicates gain numbered suffixes, and editing names renames folders. Stable numeric media URLs resolve through stored metadata so renamed games remain playable. Existing numeric folders migrate when listed; moves are checked to remain in the configured library. Nine API/storage tests passed.
