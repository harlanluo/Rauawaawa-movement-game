import { LIMITS, openVideo, sampleTimes, targetSize, transcodeFrames } from './media.js';
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

let segmenter = null;
let backgroundImage = null;
let backgroundCache = null;
let running = false;
let cancelled = false;
let downloadURL = null;
let integratedFile = null;
const embedded = window.parent !== window;
function report(type, payload = {}) {
    if (embedded) window.parent.postMessage({ source: 'video-stylizer', type, ...payload }, location.origin);
}

function setStatus(message, progress = null) {
    elements.status.textContent = message;
    report('status', { message, progress });
    if (progress === null) elements.progress.removeAttribute('value');
    else elements.progress.value = progress;
}

function setRunning(next) {
    running = next;
    elements.start.disabled = next || !(integratedFile || elements.file.files.length);
    elements.file.disabled = next;
    elements.cancel.disabled = !next;
}

function checkCancelled() {
    if (cancelled) throw new DOMException('Cancelled', 'AbortError');
}

async function loadTools() {
    const pending = [];
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

async function stylizeVideo(video) {
    const { width, height } = targetSize(video.sourceWidth, video.sourceHeight);
    const times = sampleTimes(video.duration);
    if (!times.length) throw new Error('This video has no duration');
    const outputCanvas = new OffscreenCanvas(width, height);
    const context = outputCanvas.getContext('2d');
    const imageData = context.createImageData(width, height);
    const background = backgroundPixels(width, height);
    const timestampBase = segmenter.nextTimestampBase();

    return transcodeFrames(video, {
        width, height, times, outputCanvas,
        isCancelled: () => cancelled,
        drawFrame(frame, index) {
            const segmentation = segmenter.segment(frame, timestampBase + index * 1000 / LIMITS.fps);
            stylizeFrame({
                mask: segmentation.mask, maskWidth: segmentation.width, maskHeight: segmentation.height,
                background, width, height, out: imageData.data
            });
            context.putImageData(imageData, 0, 0);
            const done = index + 1;
            if (index === 0 || done % PREVIEW_EVERY === 0 || done === times.length) showPreview(outputCanvas);
            setStatus(`Stylizing frame ${done} of ${times.length}…`, done / times.length);
        }
    });
}

function offerDownload(bytes, sourceName) {
    if (downloadURL) URL.revokeObjectURL(downloadURL);
    downloadURL = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    const baseName = sourceName.replace(/\.[^.]+$/, '') || 'video';
    const link = elements.download;
    link.href = downloadURL;
    link.download = `stylized-${baseName}.mp4`;
    link.hidden = false;
    if (!embedded) link.click();
    report('complete', { blob: new Blob([bytes], { type: 'video/mp4' }) });
}

async function run() {
    const file = integratedFile || elements.file.files[0];
    if (!file || running) return;
    cancelled = false;
    setRunning(true);
    elements.download.hidden = true;
    let stage = 'loading tools';
    let video = null;
    try {
        setStatus('Loading segmentation model…');
        await loadTools();
        checkCancelled();
        stage = 'reading video';
        setStatus('Reading video…');
        video = await openVideo(file);
        checkCancelled();
        const seconds = Math.min(video.duration, LIMITS.maxSeconds);
        const source = `${video.sourceWidth}×${video.sourceHeight} ${video.codec ?? ''}, ${video.duration.toFixed(1)}s`;
        console.info(`Video stylizer: source ${source}`);
        stage = 'stylizing';
        const result = await stylizeVideo(video);
        checkCancelled();
        offerDownload(result.bytes, file.name);
        setStatus(`Done — ${result.frames} frames (${seconds.toFixed(1)}s from ${source}), ${result.audioNote}. Video ready.`, 1);
    } catch (error) {
        if (error?.name === 'AbortError' || cancelled) {
            setStatus('Cancelled.', 0);
        } else {
            console.error(`Video stylization failed while ${stage}`, error);
            setStatus(`Failed while ${stage}: ${error?.message ?? error}`, 0);
        }
    } finally {
        video?.input.dispose();
        setRunning(false);
    }
}

function cancel() {
    if (!running) return;
    cancelled = true;
    setStatus('Cancelling…');
}

elements.file.addEventListener('change', () => {
    elements.start.disabled = running || !(integratedFile || elements.file.files.length);
    elements.download.hidden = true;
    setStatus(elements.file.files.length ? 'Ready to stylize.' : 'Choose or record a video to begin.', 0);
});
elements.start.addEventListener('click', run);
elements.cancel.addEventListener('click', cancel);

const REQUIRED = ['OffscreenCanvas', 'createImageBitmap', 'WebAssembly', 'VideoDecoder', 'VideoEncoder'];
const missing = REQUIRED.filter(name => typeof globalThis[name] === 'undefined');
if (missing.length) {
    elements.file.disabled = true;
    setStatus(`This browser is missing ${missing.join(', ')}, which this prototype needs.`, 0);
}

if (embedded) {
    document.querySelector('.controls').hidden = true;
    window.addEventListener('message', event => {
        if (event.origin !== location.origin || event.source !== window.parent) return;
        if (event.data?.type === 'stylize' && event.data.file instanceof File) {
            integratedFile = event.data.file;
            run();
        }
    });
    report('ready');
}
