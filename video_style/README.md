# Video Stylizer (prototype)

Standalone page that turns a short video into a flat-color, beach-background version:

- skin, hair and accessories → red `#E10600`
- clothes → blue `#0047FF`
- background → `assets/images/beach_background.png` (cover-fit to the frame)

Open `video_style/index.html` from any static server (e.g. `python3 -m http.server` at the repo root, then visit `/video_style/`). On phones the file picker also offers "Record Video".

## Pipeline

1. **Compress** with ffmpeg.wasm (`transcode.js`): first 60 s, 15 fps, at most 640 px wide, H.264.
2. **Extract** JPEG frames.
3. **Segment** each frame with MediaPipe `ImageSegmenter` using the `selfie_multiclass_256x256` model (`segment.js`), then **stylize** the category mask (`stylize.js`).
4. **Encode** the stylized frames (plus the original audio, if any) to MP4 and download it as `stylized-<name>.mp4`.

## Limits and notes

- Everything runs locally in the browser; the video never leaves the device.
- Uses the single-threaded ffmpeg core, so no COOP/COEP headers are needed — but it is slow. Expect roughly real-time or slower for 640 px video.
- Libraries load from jsdelivr and the model from Google Storage, so the first run needs network access.
- Requires `OffscreenCanvas`, `createImageBitmap` and WebAssembly (current Chrome, Edge, Firefox, Safari 16.4+).

Tests for the pure parts (color mapping, cover-fit, ffmpeg arguments): `node --test tests/video-style.test.mjs`.
