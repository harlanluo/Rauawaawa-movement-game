# Player changes: verification record

Date: 7 October 2026 (Pacific/Auckland).
Follow-up baseline: latest fetched `origin/feature/player-bilingual-seek-safety`, `b5a7240c70db82fa364b7e496a563d1f7da34b46`. Latest dev `cb38330cc20d768ebb04d7acbf15628d6c6b51f3` is already an ancestor; no integration was needed. Existing draft PR #17 remains based on dev.
Branch: `feature/player-bilingual-seek-safety`. No merge or production deployment was initiated.

## Automated checks

Run with Node.js v24.15.0:

```powershell
node --experimental-vm-modules --test --test-isolation=none tests/*.mjs tests/*.cjs
```

58 tests passed, zero failures. Includes existing comparison, tracker, Staff browser-library, recording and video-style suites, plus single-language rendering, bilingual switch confirmation, written/voice independence, localized accessibility, compact camera errors/approval, guidance selection/reselection/cancellation, missing and delayed device Māori voices, Staff exclusion, navigation cleanup, per-checkpoint replay improvement, transient reset, native/pointer seek gates, paused rapid seeks and stale capture/callback rejection. Camera/model tests use controlled mocks. The app lifecycle harness emits a known library mock warning because that harness supplies tracker/scoring modules rather than a real browser library; the Staff browser-library suite tests real library save/load/rename/archive behavior separately.

All `js/*.js` files passed `node --check`. All 61 HTML event handlers compiled. `git diff --check` passed.

## Localhost browser checks

Served with `python -m http.server 8000 --bind 127.0.0.1`. Used the in-app browser at 2560 × 1080, 1440 × 900, 1280 × 720, 1024 × 600 landscape tablet and 390 × 844 narrow viewports, then reset the override. Actual screenshots were inspected.

- Start → Seated → playlist → game: ready overlay visible, score zero, Camera OFF, avatar hidden. Camera immediately follows Start in controls and remains visible in both layouts.
- Interface: default English; switch directly below Voice Guidance on start, mode, playlist and game. Māori selection renders one candidate label (including accessibility, overlays, scores, dialogs and subtitles); switching back restores one English label. The switch alone always displays English / Māori. Written selection survives navigation, Retry and Next; refresh resets to English. Game names/descriptions remain source English without approved localized metadata. Staff is excluded.
- Layout: steady wide panel is 1200 × 674.46 at x=680 in a 2560-wide viewport, matching actual video ratio 854/480 and leaving equal margins. Desktop/tablet/narrow stages are constrained by remaining height; video uses contain. Avatar split and returning to video-only both work. The 1024 × 600 ready panel measures 438 × 246.18 with all controls on screen. The narrow timeline wraps its speed group; measured document width equals viewport width (390px).
- Both separate status bars are visually hidden without reserved space; dynamic updates do not expose them. Ready/pause hints remain inside video. Normal status nodes have aria-live off. Camera error is compact beside Camera and clears on Retry/Next.
- Keyboard: Start tabs directly to Camera. Enter on the language switch activates it; paused keyboard timeline seeking leaves Resume active. Language changes clear confirmation and subtitles.
- Playback with Camera OFF: Start/Pause/Resume works and score stays zero. Keyboard timeline interaction while paused leaves Resume active. Show User Avatar/Full Screen toggles layout without enabling Camera.
- Explicit Camera activation: browser reports `NotAllowedError: Permission denied by system`. Localized camera denial appears beside the bottom Camera button and is associated through aria-describedby; it remains accessible and video/layout controls continue working. Real camera permission grant, model inference and movement quality were not verified.
- Voice OFF → panel: English/Māori choices, close and explicit OFF actions are visible. Māori selection closes the panel and enables guidance without approval. With no device Māori voice it retains Māori selection and text prompts; a device-availability notice offers English audio explicitly. English selection enables guidance. First Resume click speaks/displays its prompt and confirmation; second click resumes. With written Māori and spoken English, first language-switch click keeps Māori and displays confirmation, second selects English and clears subtitles/focus; the voice panel still shows English selected. Speech text/subtitle behavior was observed; pronunciation or audible voice quality was not certified.
- Finish → results → Retry and Finish → Next: each new game is ready with zero score, Camera OFF and avatar hidden. Quit returns to playlist. Staff entry/navigation stays English.

## Older-player readability follow-up

After baseline `2692b8835e0cf6cad1932ca53f2e5934d2d3fd95`, enlarged player typography and interaction targets across start, mode, playlist, game, results and voice dialog. Fixed enlarged-header/card overlap, inaccessible first playlist row, narrow result overflow and old Back-button size overrides. Dark labels improve bright-button contrast. Short screens may scroll vertically to retain readable controls; the source video stays contained and the hidden status bars remain absent. Earlier stage measurements above describe the preceding revision rather than the final larger-header layout.

The full Node command above was rerun: 58 passed, zero failures. Diff whitespace checks passed. Actual responsive browser screenshots were inspected, including avatar split and selected-language labels. See [the detailed UI review](player-ui-accessibility-review.md) for font/target sizes, observed viewports and remaining device/user-testing limits.

## Remaining acceptance limits

No physical-camera scoring, real-user/kaumātua testing, tablet hardware permission grant or approved Māori pronunciation test was performed. Controlled pose/capture tests do not establish device performance. Written Māori, speech scripts, exercise metadata, number wording and voice delivery await separate human review in `player-language-review.md`.

No Netlify settings were inspected or changed, and no deployment controls were used. A pushed feature branch or dev-targeted PR may trigger the repository's existing automatic preview configuration; preview publication is not asserted here.


## Open Māori voice revision

Continued from ce21cd9. All 58 Node tests pass. Added coverage for mi and mi-NZ device voice selection, draft scripts without approval, missing-voice selection retained with text prompts, delayed voices, explicit English switch, Māori confirmation audio, and exclusion of editorial notes from speech. Real localhost browser checks confirm that selecting Māori enables Guidance ON, closes the dialog and marks Māori selected when reopened. This device has no Māori voice, so real Māori audio was not heard; voice delivery was verified with controlled mocks. No approval gate remains. Dictionary-supported content checks and corrections are recorded in player-language-review.md.
