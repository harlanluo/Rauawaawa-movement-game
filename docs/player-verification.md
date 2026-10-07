# Player changes: verification record

Date: 7 October 2026 (Pacific/Auckland).
Baseline: latest fetched `origin/dev`, `cb38330cc20d768ebb04d7acbf15628d6c6b51f3`.
Branch: `feature/player-bilingual-seek-safety`. No merge or production deployment was initiated.

## Automated checks

Run with Node.js v24.15.0:

```powershell
node --experimental-vm-modules --test --test-isolation=none tests/*.mjs tests/*.cjs
```

54 tests passed, zero failures. Includes existing comparison, tracker, Staff browser-library, recording and video-style suites, plus language preview/approval, guidance selection/reselection/cancellation, delayed unapproved Māori voice, Staff exclusion, navigation cleanup, per-checkpoint replay improvement, transient reset, native/pointer seek gates, paused rapid seeks and stale capture/callback rejection. Camera/model tests use controlled mocks. The app lifecycle harness emits a known library mock warning because that harness supplies tracker/scoring modules rather than a real browser library; the Staff browser-library suite tests real library save/load/rename/archive behavior separately.

All `js/*.js` files passed `node --check`. All 58 HTML event handlers compiled. `git diff --check` passed.

## Localhost browser checks

Served with `python -m http.server 8000 --bind 127.0.0.1`. Used the in-app browser, including a landscape tablet viewport override requested at 1024 × 768, then reset the override.

- Start → Seated → playlist → game: ready overlay visible, score zero, Camera OFF, avatar hidden. Camera immediately follows Start in controls and remains visible in both layouts.
- Draft preview: Māori above English on player controls/headings/messages/results; larger controls wrap. Shorter game screens scroll; the stage minimum height keeps the ready hint readable. English secondary text stays at least 18px. Staff login remained English with zero Māori lines.
- Playback with Camera OFF: Start/Pause/Resume works and score stays zero. Keyboard timeline interaction while paused leaves Resume active. Show User Avatar/Full Screen toggles layout without enabling Camera.
- Explicit Camera activation: browser reports `NotAllowedError: Permission denied by system`. Friendly Camera access is off feedback remains accessible and video/layout controls continue working. Real camera permission grant, model inference and movement quality were not verified.
- Voice OFF → panel: English/Māori choices, close and explicit OFF actions are visible. Māori selection keeps the panel open with approval limitation and explicit English choice. English selection enables guidance. First Resume click speaks/displays its prompt and confirmation; second click resumes. Speech text/subtitle behavior was observed; pronunciation or audible voice quality was not certified.
- Finish → results → Retry and Finish → Next: each new game is ready with zero score, Camera OFF and avatar hidden. Quit returns to playlist. Staff entry/navigation stays English.

## Remaining acceptance limits

No physical-camera scoring, real-user/kaumātua testing, tablet hardware permission grant or approved Māori pronunciation test was performed. Controlled pose/capture tests do not establish device performance. Written Māori, speech scripts, exercise metadata, number wording and voice delivery await separate human review in `player-language-review.md`.

No Netlify settings were inspected or changed, and no deployment controls were used. A pushed feature branch or dev-targeted PR may trigger the repository's existing automatic preview configuration; preview publication is not asserted here.
