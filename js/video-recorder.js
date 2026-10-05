export function createVideoRecorder({ video, onState, onTime, onComplete, normalize,
    mediaDevices = navigator.mediaDevices, Recorder = globalThis.MediaRecorder }) {
    let token = 0, stream = null, recorder = null, timer = null, previewURL = null;
    let state = 'idle';
    const setState = (next, message) => { state = next; onState(next, message); };
    const release = () => {
        clearInterval(timer); timer = null;
        stream?.getTracks().forEach(track => track.stop()); stream = null;
        video.srcObject = null;
    };
    const reset = () => {
        ++token;
        if (recorder?.state === 'recording') recorder.stop();
        recorder = null;
        release();
        if (previewURL) URL.revokeObjectURL(previewURL);
        previewURL = null;
        video.removeAttribute('src'); video.load(); video.hidden = true;
        onTime(0); setState('idle', 'Ready to record');
    };
    const stop = () => {
        if (recorder?.state === 'recording') {
            clearInterval(timer);
            setState('saving', 'Preparing recording…');
            recorder.stop();
            release();
        }
    };
    async function start({ audio = false } = {}) {
        if (!['idle', 'error'].includes(state)) return;
        const current = ++token;
        if (!mediaDevices?.getUserMedia || !Recorder) {
            setState('error', 'Recording requires Chrome or Edge on localhost or HTTPS.'); return;
        }
        setState('starting', 'Allow camera access to start recording…');
        try {
            const acquired = await mediaDevices.getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio
            });
            if (current !== token) { acquired.getTracks().forEach(track => track.stop()); return; }
            stream = acquired;
            video.hidden = false; video.controls = false; video.muted = true;
            video.srcObject = stream;
            await video.play();
            if (current !== token) return;
            const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4']
                .find(type => Recorder.isTypeSupported(type));
            if (!mimeType) throw new Error('This browser has no supported recording format.');
            const chunks = [];
            recorder = new Recorder(stream, { mimeType, videoBitsPerSecond: 2000000 });
            recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
            recorder.onerror = event => {
                if (current !== token) return;
                ++token; release();
                setState('error', event.error?.message || 'Camera recording failed. Please retake.');
            };
            recorder.onstop = async () => {
                if (current !== token) return;
                release();
                try {
                    if (!chunks.length) throw new Error('No video captured. Please record again.');
                    const raw = new Blob(chunks, { type: mimeType });
                    const file = await normalize(raw, () => current !== token);
                    if (current !== token) return;
                    previewURL = URL.createObjectURL(file);
                    video.src = previewURL; video.controls = true; video.muted = false;
                    video.load();
                    onComplete(file, previewURL);
                    setState('ready', 'Recording ready — preview it or continue to processing.');
                } catch (error) {
                    if (current === token) setState('error', error.message);
                }
            };
            recorder.start(250);
            const started = Date.now();
            onTime(0); setState('recording', 'Recording — stops automatically at 60 seconds');
            timer = setInterval(() => {
                const seconds = Math.floor((Date.now() - started) / 1000);
                onTime(Math.min(seconds, 60));
                if (seconds >= 60) stop();
            }, 250);
            for (const track of stream.getTracks()) track.onended = () => {
                if (current === token && state === 'recording') stop();
            };
        } catch (error) {
            if (current !== token) return;
            release();
            setState('error', error.name === 'NotAllowedError'
                ? 'Camera access was denied. Allow access and try again.' : error.message);
        }
    }
    return { start, stop, reset, getState: () => state };
}

// Camera encoders produce variable timestamps. Normalize before the existing
// constant-frame-rate Python extractor, preserving the same timeline for stylization.
export async function normalizeRecording(blob, isCancelled) {
    const { openVideo, targetSize, sampleTimes, transcodeFrames } = await import('../video_style/media.js');
    const video = await openVideo(blob);
    try {
        const { width, height } = targetSize(video.sourceWidth, video.sourceHeight);
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d');
        const result = await transcodeFrames(video, {
            width, height, outputCanvas: canvas, times: sampleTimes(video.duration), isCancelled,
            drawFrame(frame) { context.drawImage(frame, 0, 0, width, height); }
        });
        return new File([result.bytes], `recording-${Date.now()}.mp4`, { type: 'video/mp4' });
    } finally { video.input.dispose(); }
}
