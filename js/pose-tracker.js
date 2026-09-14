const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs';
const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

// Only the hidden player camera is processed locally. Frames are never saved or uploaded.
// Future reference poses will be loaded separately; demonstration videos are not inputs here.
export function createPoseTracker({ onStatus = () => {}, forceCPU = false } = {}) {
    const video = document.createElement('video');
    video.hidden = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('aria-hidden', 'true');
    const hasVideoCallbacks = typeof video.requestVideoFrameCallback === 'function';
    let model = null;
    let initialization = null;
    let startup = Promise.resolve();
    let stream = null;
    let generation = 0;
    let destroyed = false;
    let paused = false;
    let frame = null;
    let latest = null;
    let state = 'stopped';
    let delegate = null;
    let width = 0;
    let height = 0;
    let lastInference = -Infinity;
    let lastVideoTime = -1;
    let inferenceMs = 0;
    let measuredFPS = 0;
    let lastSample = 0;

    function status(next, message) {
        if (state === next) return;
        state = next;
        try { onStatus({ state, message }); }
        catch (error) { console.warn('Pose status listener failed', error); }
    }

    async function initialize() {
        if (destroyed) throw new Error('Tracker destroyed');
        if (model) return;
        if (!initialization) {
            initialization = (async () => {
                const { FilesetResolver, PoseLandmarker } = await import(VISION_URL);
                const files = await FilesetResolver.forVisionTasks(WASM_ROOT);
                for (const candidate of forceCPU ? ['CPU'] : ['GPU', 'CPU']) {
                    let created;
                    try {
                        created = await PoseLandmarker.createFromOptions(files, {
                            baseOptions: { modelAssetPath: MODEL_URL, delegate: candidate },
                            runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: false
                        });
                    } catch (error) {
                        console.warn(`Pose ${candidate} initialization failed`, error);
                        if (candidate === 'CPU') throw error;
                        continue;
                    }
                    if (destroyed) { created.close(); return; }
                    model = created;
                    delegate = candidate;
                    return;
                }
            })().finally(() => { initialization = null; });
        }
        return initialization;
    }

    function cancelFrame() {
        if (frame === null) return;
        if (hasVideoCallbacks) video.cancelVideoFrameCallback(frame);
        else cancelAnimationFrame(frame);
        frame = null;
    }

    function stop() {
        generation++;
        cancelFrame();
        if (stream) stream.getTracks().forEach(track => track.stop());
        stream = null;
        video.pause();
        video.srcObject = null;
        latest = null;
        width = height = inferenceMs = measuredFPS = lastSample = 0;
        lastVideoTime = -1;
        paused = false;
        status('stopped', 'Camera off');
    }

    function fail(error) {
        console.warn('Player camera tracking unavailable', error);
        stop();
        const messages = {
            NotAllowedError: 'Camera access is off',
            NotFoundError: 'No camera found',
            NotReadableError: 'Camera is busy',
            AbortError: 'Camera unavailable'
        };
        status('unavailable', messages[error.name] || 'Camera unavailable');
    }

    function schedule(token) {
        if (paused || !stream || token !== generation || frame !== null) return;
        const callback = now => {
            frame = null;
            if (paused || !stream || token !== generation) return;
            if (video.readyState >= 2 && video.currentTime !== lastVideoTime &&
                now - lastInference >= 1000 / 15) {
                lastVideoTime = video.currentTime;
                lastInference = now;
                try {
                    const begin = performance.now();
                    const result = model.detectForVideo(video, begin);
                    const elapsed = performance.now() - begin;
                    inferenceMs = inferenceMs ? inferenceMs * 0.9 + elapsed * 0.1 : elapsed;
                    if (lastSample) {
                        const fps = 1000 / (begin - lastSample);
                        measuredFPS = measuredFPS ? measuredFPS * 0.9 + fps * 0.1 : fps;
                    }
                    lastSample = begin;
                    latest = result.landmarks[0]?.map(point => ({ ...point })) || null;
                    status(latest ? 'detected' : 'looking', latest ? 'Player detected' : 'Looking for you…');
                } catch (error) { fail(error); return; }
            }
            schedule(token);
        };
        frame = hasVideoCallbacks ? video.requestVideoFrameCallback(callback) : requestAnimationFrame(callback);
    }

    function start() {
        stop();
        const token = generation;
        status('starting', 'Starting camera…');
        // Serialize permission requests, including one still pending when a game was left.
        startup = startup.then(async () => {
            if (token !== generation || destroyed) return;
            try {
                if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia unavailable');
                await initialize();
                if (token !== generation || destroyed) return;
                const acquired = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 },
                        frameRate: { ideal: 30, max: 30 } }
                });
                if (token !== generation || destroyed) {
                    acquired.getTracks().forEach(track => track.stop());
                    return;
                }
                stream = acquired;
                stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
                    if (token === generation) fail(new Error('Camera stream ended'));
                }, { once: true }));
                video.srcObject = stream;
                await video.play();
                if (token !== generation || destroyed) return;
                width = video.videoWidth;
                height = video.videoHeight;
                status(paused ? 'paused' : 'looking', paused ? 'Tracking paused' : 'Looking for you…');
                schedule(token);
            } catch (error) {
                if (token === generation && !destroyed) fail(error);
            }
        });
        return startup;
    }

    function pauseProcessing() {
        paused = true;
        cancelFrame();
        latest = null;
        measuredFPS = lastSample = 0;
        if (stream || state === 'starting') status('paused', 'Tracking paused');
    }

    function resumeProcessing() {
        paused = false;
        if (stream) {
            status('looking', 'Looking for you…');
            schedule(generation);
        } else if (state === 'paused') status('starting', 'Starting camera…');
    }

    function destroy() {
        stop();
        destroyed = true;
        if (model) model.close();
        model = null;
    }

    return {
        initialize, start, pauseProcessing, resumeProcessing, stop, destroy,
        getLatestLandmarks: () => latest?.map(point => ({ ...point })) || null,
        getDiagnostics: () => ({ state, cameraWidth: width, cameraHeight: height, delegate,
            targetInferenceFPS: 15, measuredInferenceFPS: measuredFPS, smoothedInferenceMs: inferenceMs,
            requestVideoFrameCallback: hasVideoCallbacks, personDetected: latest !== null,
            modelProfile: 'Lite float16', frameScheduled: frame !== null,
            trackStates: stream ? stream.getVideoTracks().map(track => track.readyState) : [] })
    };
}
