# Video Stylizer (prototype)

Standalone page that turns a short video into a flat-color, beach-background version:

- skin, hair and accessories → red `#E10600`
- clothes → blue `#0047FF`
- background → `assets/images/beach_background.png` (cover-fit to the frame)

Open `video_style/index.html` from any static server (e.g. `python3 -m http.server` at the repo root, then visit `/video_style/`). On phones the file picker also offers "Record Video".

## Pipeline

1. **Open**: [Mediabunny](https://mediabunny.dev) demuxes the MP4/MOV/WebM (`media.js`).
2. **Decode**: frames are decoded with WebCodecs (the browser's hardware decoder, which handles HEVC/HDR and rotation), sampled at 15 fps for the first 60 s and scaled to at most 640 px wide.
3. **Segment + stylize**: MediaPipe `ImageSegmenter` with `selfie_multiclass_256x256` (`segment.js`) produces a category mask; `stylize.js` paints it.
4. **Encode**: H.264 via WebCodecs, muxed to MP4 with the original audio copied through (no re-encode), downloaded as `stylized-<name>.mp4`.

Frames stream decode → stylize → encode one at a time, so memory stays flat regardless of clip size.

## Limits and notes

- Everything runs locally in the browser; the video never leaves the device.
- Caps: 60 s, 15 fps, 640 px wide.
- Audio is kept only when its codec fits in MP4 (AAC, Opus, MP3, …); otherwise the output is silent and the status says so.
- Libraries load from jsdelivr and the model from Google Storage, so the first run needs network access.
- **Use Chrome or Edge (94+).** Safari 16.4+ and Firefox 130+ have the APIs, but Safari stalls
  while encoding frame 8 (confirmed via the console heartbeat), most likely in Mediabunny's wait for the H.264 encoder's `dequeue` event. Each decode/encode step now
  gives up after 20s with "Stalled while <step> frame N", and the console logs a decoded/segmented/encoded heartbeat per frame.
- Safari logs a 404 for `vision_bundle_mjs.js.map`; that's DevTools looking for a source map MediaPipe doesn't publish, and is harmless.

Tests for the pure parts (color mapping, cover-fit, sizing, frame timing): `node --test tests/video-style.test.mjs`.
