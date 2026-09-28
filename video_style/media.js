// Video decode/encode via WebCodecs, using Mediabunny for container demuxing and muxing.
// The browser's (usually hardware) codecs do the work, so nothing large lives in a wasm heap.
const MEDIABUNNY_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1.60.0/dist/bundles/mediabunny.min.mjs';

export const LIMITS = Object.freeze({ maxSeconds: 60, fps: 15, maxWidth: 640 });

// Output size that keeps the aspect ratio, never upscales, and has even dimensions (H.264 4:2:0).
export function targetSize(width, height, maxWidth = LIMITS.maxWidth) {
    const scale = Math.min(1, maxWidth / width);
    const even = value => Math.max(2, Math.floor(value * scale / 2) * 2);
    return { width: even(width), height: even(height) };
}

// Timestamps (seconds) to sample, one per output frame, capped at maxSeconds.
export function sampleTimes(duration, fps = LIMITS.fps, maxSeconds = LIMITS.maxSeconds) {
    const length = Math.min(duration, maxSeconds);
    if (!(length > 0)) return [];
    const count = Math.max(1, Math.floor(length * fps + 1e-6));
    return Array.from({ length: count }, (_, index) => index / fps);
}

let modulePromise = null;
function loadMediabunny() {
    modulePromise ??= import(MEDIABUNNY_URL).catch(error => {
        modulePromise = null;
        throw error;
    });
    return modulePromise;
}

export async function openVideo(file) {
    const mb = await loadMediabunny();
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    try {
        const videoTrack = await input.getPrimaryVideoTrack();
        if (!videoTrack) throw new Error('No video track found in this file');
        const codec = await videoTrack.getCodec();
        if (!(await videoTrack.canDecode())) {
            throw new Error(`This browser can't decode this video's codec (${codec ?? 'unknown'})`);
        }
        const [sourceWidth, sourceHeight, duration, audioTrack] = await Promise.all([
            videoTrack.getDisplayWidth(),
            videoTrack.getDisplayHeight(),
            input.computeDuration(),
            input.getPrimaryAudioTrack()
        ]);
        return { mb, input, videoTrack, audioTrack, codec, sourceWidth, sourceHeight, duration };
    } catch (error) {
        input.dispose();
        throw error;
    }
}

// Decodes frames at `times`, lets `drawFrame(sourceCanvas, index)` paint the output canvas,
// and encodes the result (plus the source audio, copied without re-encoding) to MP4 bytes.
export async function transcodeFrames(video, {
    width, height, times, fps = LIMITS.fps, maxSeconds = LIMITS.maxSeconds,
    outputCanvas, drawFrame, isCancelled = () => false
}) {
    const { mb, videoTrack, audioTrack } = video;
    if (!(await mb.canEncodeVideo('avc', { width, height, bitrate: mb.QUALITY_MEDIUM, frameRate: fps }))) {
        throw new Error(`This browser can't encode H.264 at ${width}×${height}`);
    }
    const format = new mb.Mp4OutputFormat({ fastStart: 'in-memory' });
    const output = new mb.Output({ format, target: new mb.BufferTarget() });
    const videoSource = new mb.CanvasSource(outputCanvas, { codec: 'avc', bitrate: mb.QUALITY_MEDIUM });
    output.addVideoTrack(videoSource, { frameRate: fps });

    let audioSource = null;
    let audioNote = 'no audio track';
    if (audioTrack) {
        const audioCodec = await audioTrack.getCodec();
        if (audioCodec && format.getSupportedAudioCodecs().includes(audioCodec)) {
            audioSource = new mb.EncodedAudioPacketSource(audioCodec);
            output.addAudioTrack(audioSource);
            audioNote = `audio copied (${audioCodec})`;
        } else {
            audioNote = `audio dropped (${audioCodec ?? 'unknown codec'} can't go in MP4)`;
        }
    }

    let finished = false;
    try {
        await output.start();
        const sink = new mb.CanvasSink(videoTrack, { width, height, fit: 'fill', poolSize: 2 });
        let index = 0;
        for await (const wrapped of sink.canvasesAtTimestamps(times)) {
            if (isCancelled()) throw new DOMException('Cancelled', 'AbortError');
            if (wrapped) await drawFrame(wrapped.canvas, index);
            // A missing frame (null) re-encodes the previous output so timing stays intact.
            await videoSource.add(index / fps, 1 / fps);
            index++;
        }
        videoSource.close();

        if (audioSource) {
            const decoderConfig = await audioTrack.getDecoderConfig();
            const endTime = Math.min(maxSeconds, times.length / fps);
            let first = true;
            for await (const packet of new mb.EncodedPacketSink(audioTrack).packets()) {
                if (isCancelled()) throw new DOMException('Cancelled', 'AbortError');
                if (packet.timestamp >= endTime) break;
                await audioSource.add(packet, first && decoderConfig ? { decoderConfig } : undefined);
                first = false;
            }
            audioSource.close();
        }

        await output.finalize();
        finished = true;
        return { bytes: new Uint8Array(output.target.buffer), frames: index, audioNote };
    } finally {
        if (!finished) {
            try { await output.cancel(); } catch { /* already torn down */ }
        }
    }
}
