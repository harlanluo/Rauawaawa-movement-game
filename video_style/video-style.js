import { createTranscoder, LIMITS } from './transcode.js';
import { createSegmenter } from './segment.js';
import { coverRect, stylizeFrame } from './stylize.js';

const BACKGROUND_URL = new URL('../assets/images/beach_background.png', import.meta.url);
const PREVIEW_EVERY = 5;

const elements = {
    file: document.querySelector('#video-file'),
    start: document.querySelector('#stylize'),
    cancel: document.querySelector('#cancel'),
    status: document.querySelector('#status'),
    progress: document.querySelector('#progress'),
    preview: document.querySelector('#preview'),
    download: document.querySelector('#download')
};

let transcoder = null;
let segmenter = null;
let backgroundImage = null;
let backgroundCache = null;
let running = false;
let cancelled = false;
let downloadURL = null;

function setStatus(message, progress = null) {
    elements.status.textContent = message;
    if (progress === null) elements.progress.removeAttribute('value');
    else elements.progress.value = progress;
}

function setRunning(next) {
    running = next;
    elements.start.disabled = next || !elements.file.files.length;
    elements.file.disabled = next;
    elements.cancel.disabled = !next;
}

function checkCancelled() {
    if (cancelled) throw new DOMException('Cancelled', 'AbortError');
}

async function loadTools() {
    const pending = [];
    if (!transcoder) pending.push(createTranscoder().then(created => { transcoder = created; }));
    if (!segmenter) pending.push(createSegmenter().then(created => { segmenter = created; }));
    if (!backgroundImage) {
        pending.push(fetch(BACKGROUND_URL)
            .then(response => {
                if (!response.ok) throw new Error(`Background image failed to load (${response.status})`);
                return response.blob();
            })
            .then(blob => createImageBitmap(blob))
            .then(bitmap => { backgroundImage = bitmap; }));
    }
    await Promise.all(pending);
}

function backgroundPixels(width, height) {
    if (backgroundCache?.width === width && backgroundCache?.height === height) return backgroundCache.data;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    const { sx, sy, sw, sh } = coverRect(backgroundImage.width, backgroundImage.height, width, height);
    context.drawImage(backgroundImage, sx, sy, sw, sh, 0, 0, width, height);
    backgroundCache = { width, height, data: context.getImageData(0, 0, width, height).data };
    return backgroundCache.data;
}

function showPreview(canvas) {
    const preview = elements.preview;
    const scale = Math.min(1, 480 / canvas.width);
    preview.width = Math.round(canvas.width * scale);
    preview.height = Math.round(canvas.height * scale);
    preview.getContext('2d').drawImage(canvas, 0, 0, preview.width, preview.height);
}

async function stylizeFrames(frameCount) {
    await transcoder.prepareOutput();
    const timestampBase = segmenter.nextTimestampBase();
    let canvas = null;
    let context = null;
    let imageData = null;
    for (let index = 1; index <= frameCount; index++) {
        checkCancelled();
        const bytes = await transcoder.readFrame(index);
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
        const { width, height } = bitmap;
        let segmentation;
        try {
            segmentation = segmenter.segment(bitmap, timestampBase + (index - 1) * 1000 / LIMITS.fps);
        } finally {
            bitmap.close();
        }
        if (!canvas || canvas.width !== width || canvas.height !== height) {
            canvas = new OffscreenCanvas(width, height);
            context = canvas.getContext('2d');
            imageData = context.createImageData(width, height);
        }
        stylizeFrame({
            mask: segmentation.mask, maskWidth: segmentation.width, maskHeight: segmentation.height,
            background: backgroundPixels(width, height), width, height, out: imageData.data
        });
        context.putImageData(imageData, 0, 0);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
        await transcoder.writeOutputFrame(index, new Uint8Array(await blob.arrayBuffer()));
        await transcoder.deleteFrame(index);
        if (index === 1 || index % PREVIEW_EVERY === 0 || index === frameCount) showPreview(canvas);
        setStatus(`Stylizing frame ${index} of ${frameCount}…`, index / frameCount);
    }
}

function offerDownload(bytes, sourceName) {
    if (downloadURL) URL.revokeObjectURL(downloadURL);
    downloadURL = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    const baseName = sourceName.replace(/\.[^.]+$/, '') || 'video';
    const link = elements.download;
    link.href = downloadURL;
    link.download = `stylized-${baseName}.mp4`;
    link.hidden = false;
    link.click();
}

async function run() {
    const file = elements.file.files[0];
    if (!file || running) return;
    cancelled = false;
    setRunning(true);
    elements.download.hidden = true;
    try {
        setStatus('Loading video tools and segmentation model…');
        await loadTools();
        checkCancelled();
        setStatus(`Compressing (max ${LIMITS.maxSeconds}s, ${LIMITS.fps} fps, ${LIMITS.maxWidth}px wide)…`, 0);
        await transcoder.compress(file, progress => setStatus('Compressing…', progress));
        checkCancelled();
        setStatus('Extracting frames…');
        const frameCount = await transcoder.extractFrames();
        if (!frameCount) throw new Error('No video frames were found in this file');
        await stylizeFrames(frameCount);
        setStatus('Encoding stylized video…', 0);
        const output = await transcoder.encode(progress => setStatus('Encoding stylized video…', progress));
        checkCancelled();
        offerDownload(output, file.name);
        setStatus(`Done — ${frameCount} frames stylized. Download started.`, 1);
    } catch (error) {
        if (error?.name === 'AbortError' || cancelled) {
            setStatus('Cancelled.', 0);
        } else {
            console.error('Video stylization failed', error);
            setStatus(`Failed: ${error?.message ?? error}`, 0);
        }
    } finally {
        if (transcoder) {
            try { await transcoder.cleanup(); } catch (error) { console.warn('Cleanup failed', error); }
        }
        setRunning(false);
    }
}

function cancel() {
    if (!running) return;
    cancelled = true;
    setStatus('Cancelling…');
    // Terminating is the only way to stop an in-flight ffmpeg command; it reloads on next run.
    if (transcoder) {
        const stopping = transcoder;
        transcoder = null;
        stopping.terminate();
    }
}

elements.file.addEventListener('change', () => {
    elements.start.disabled = running || !elements.file.files.length;
    elements.download.hidden = true;
    setStatus(elements.file.files.length ? 'Ready to stylize.' : 'Choose or record a video to begin.', 0);
});
elements.start.addEventListener('click', run);
elements.cancel.addEventListener('click', cancel);

if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined' || typeof WebAssembly === 'undefined') {
    elements.file.disabled = true;
    setStatus('This browser is missing OffscreenCanvas, createImageBitmap or WebAssembly, which this prototype needs.', 0);
}
