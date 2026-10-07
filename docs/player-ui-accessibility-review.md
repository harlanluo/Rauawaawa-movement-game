# Player readability review — 7 October 2026

Baseline: `2692b8835e0cf6cad1932ca53f2e5934d2d3fd95`, continuing `feature/player-bilingual-seek-safety` and draft PR #17 (base `dev`). This revision changes player presentation only; camera, language, speech and scoring logic are unchanged.

The previous narrow-screen rules reduced the game title to 22px, the score label to 15px and language/guidance controls to 18–20px. Those sizes were unsuitable for the intended large, readable player interface. The review covered start, movement-mode selection, playlist, game, results and the voice dialog, including English and longer Māori labels.

## Changes

| Element | New CSS font size / target |
| --- | --- |
| Game title | 44–64px desktop; 40px narrow |
| Score number | 48–64px; 48px narrow |
| Score label | 32–40px; 28px narrow |
| Game actions | 36–44px desktop, 32px landscape tablet, 28px narrow; minimum height 104px |
| Guidance and written-language switch | 28–34px desktop, 26px narrow; minimum height 72px |
| Back/Home | 28–34px; minimum height 80px |
| Start / Seated / Standing | Start 44–56px; modes 48–60px; narrow modes stack vertically with minimum height 144px |
| Playlist | Titles 40–48px, descriptions 24px; single column on narrow screens |
| Timeline / speed | 24px; 48px slider thumb, 60px range/select height |
| Ready/pause overlay | 32–44px desktop, 28px narrow; hint 24px / 22px narrow |
| Results | Heading 48–64px / 40px narrow; score 64px; actions 32px and minimum height 96px |
| Voice dialog | Heading 36px, explanatory text 24px, actions 30px and minimum height 96px |

Bright action buttons use dark labels for better contrast. Back/Home uses white on `#536c77` (approximately 5.56:1). Focus outlines and button borders were darkened; hover no longer shifts these large targets. Staff entry stays in the lower-right corner with 28px text. Staff page layouts retain their existing styling.

The enlarged playlist header now reserves its actual height. The first card remains reachable even when the list overflows. Results wrap within the viewport. Long camera/avatar labels receive more space and wrap rather than shrinking. Narrow movement choices stack instead of squeezing two large labels into columns. The video retains contain sizing and a proportional, centered stage; narrow screens reserve sufficient overlay height without cropping the source movement.

## Verification

Actual localhost browser screenshots were inspected at wide desktop, ordinary desktop, landscape tablet and narrow-phone settings: 2560×1080, 1440×900, 1024×600 and 390×844. Browser zoom/scaling can make the CSS viewport differ from the requested screenshot size: the final ordinary-desktop capture reported a 1309×818 CSS viewport, with title 51.64px, score number 53.09px and Resume 39.85px. Its document width equals its CSS viewport width. The wide capture showed 64px title and score number, 44px game controls and a centered proportional stage with visible margins.

At the narrow check, title was 40px, score number 48px and Back 28px with an 80px target. The playlist first item, ready hint, localized dialog actions and results were reachable without horizontal overflow. The landscape-tablet check kept title 44px and game controls 32px, including Camera immediately after playback; it needed approximately 62px of vertical scrolling. This is an intentional consequence of retaining large controls and usable video content on short screens. Avatar split mode and returning to video-only were checked. The two hidden status bars stayed absent.

The full existing Node suite passed: 58 tests, zero failures. `git diff --check` passed. These are automated/mock regressions for language, voice selection, camera lifecycle, seeking/scoring and Staff/library behavior, not physical device validation.

The review follows the practical themes in [W3C guidance for older users](https://www.w3.org/WAI/older-users/) and [developing accessible sites for older people](https://www.w3.org/WAI/older-users/developing/): readable text, large targets, contrast and adaptable layouts. This is not a formal WCAG certification or evidence of usability with actual kaumātua. Real-user feedback, physical tablet/camera performance, Māori pronunciation and a systematic browser-zoom audit remain unverified. No application logic or deployment configuration was changed.
