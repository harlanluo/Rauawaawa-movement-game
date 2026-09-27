const FFMPEG_ROOT = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm';
const UTIL_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js';
// Single-threaded core: no SharedArrayBuffer, so no COOP/COEP headers are required.
const CORE_ROOT = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

export const LIMITS = Object.freeze({ maxSeconds: 60, fps: 15, maxWidth: 640 });
export const COMPRESSED = 'compressed.mp4';
export const FRAME_DIR = 'frames';
export const OUT_DIR = 'out';
export const OUTPUT = 'stylized.mp4';

export function framePath(dir, index) {
    return `${dir}/f_${String(index).padStart(5, '0')}.jpg`;
}

export function compressArgs(input, output = COMPRESSED, limits = LIMITS) {
    return [
        '-i', input,
        '-t', String(limits.maxSeconds),
        // Even width keeps libx264/yuv420p happy; -2 keeps the aspect with an even height.
        '-vf', `fps=${limits.fps},scale='trunc(min(${limits.maxWidth},iw)/2)*2':-2`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k',
        output
    ];
}

export function extractFramesArgs(input = COMPRESSED, dir = FRAME_DIR) {
    return ['-i', input, '-an', '-q:v', '3', `${dir}/f_%05d.jpg`];
}

export function encodeArgs({ frameDir = OUT_DIR, audioSource = COMPRESSED, output = OUTPUT, fps = LIMITS.fps } = {}) {
    return [
        '-framerate', String(fps),
        '-i', `${frameDir}/f_%05d.jpg`,
        '-i', audioSource,
        '-map', '0:v', '-map', '1:a?',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'copy', '-shortest', '-movflags', '+faststart',
        output
    ];
}

export function inputName(fileName = '') {
    const match = /\.([a-z0-9]{1,5})$/i.exec(fileName);
    return `input.${match ? match[1].toLowerCase() : 'mp4'}`;
}

export async function createTranscoder({ onLog = () => {} } = {}) {
    const [{ FFmpeg }, { toBlobURL, fetchFile }] = await Promise.all([
        import(`${FFMPEG_ROOT}/index.js`),
        import(UTIL_URL)
    ]);
    const ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => onLog(message));
    // Cross-origin module workers are blocked, so start a same-origin blob worker
    // that imports the CDN worker (jsdelivr serves it with CORS).
    const workerSource = `import '${FFMPEG_ROOT}/worker.js';`;
    const classWorkerURL = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${CORE_ROOT}/ffmpeg-core.js`, 'text/javascript'),
        toBlobURL(`${CORE_ROOT}/ffmpeg-core.wasm`, 'application/wasm')
    ]);
    await ffmpeg.load({ classWorkerURL, coreURL, wasmURL });
    let progressListener = null;

    async function run(args, onProgress) {
        if (progressListener) ffmpeg.off('progress', progressListener);
        progressListener = onProgress ? ({ progress }) => onProgress(Math.min(1, Math.max(0, progress))) : null;
        if (progressListener) ffmpeg.on('progress', progressListener);
        try {
            const code = await ffmpeg.exec(args);
            if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
        } finally {
            if (progressListener) ffmpeg.off('progress', progressListener);
            progressListener = null;
        }
    }

    async function removeDir(dir) {
        let entries = [];
        try { entries = await ffmpeg.listDir(dir); } catch { return; }
        for (const entry of entries) {
            if (entry.isDir) continue;
            await ffmpeg.deleteFile(`${dir}/${entry.name}`);
        }
        await ffmpeg.deleteDir(dir);
    }

    async function tryDelete(path) {
        try { await ffmpeg.deleteFile(path); } catch { /* already gone */ }
    }

    return {
        async compress(file, onProgress) {
            const input = inputName(file.name);
            await ffmpeg.writeFile(input, await fetchFile(file));
            try { await run(compressArgs(input), onProgress); }
            finally { await tryDelete(input); }
        },
        async extractFrames() {
            await removeDir(FRAME_DIR);
            await ffmpeg.createDir(FRAME_DIR);
            await run(extractFramesArgs());
            const entries = await ffmpeg.listDir(FRAME_DIR);
            return entries.filter(entry => !entry.isDir && entry.name.endsWith('.jpg')).length;
        },
        async prepareOutput() {
            await removeDir(OUT_DIR);
            await ffmpeg.createDir(OUT_DIR);
        },
        readFrame: index => ffmpeg.readFile(framePath(FRAME_DIR, index)),
        deleteFrame: index => ffmpeg.deleteFile(framePath(FRAME_DIR, index)),
        writeOutputFrame: (index, bytes) => ffmpeg.writeFile(framePath(OUT_DIR, index), bytes),
        async encode(onProgress) {
            await run(encodeArgs(), onProgress);
            return ffmpeg.readFile(OUTPUT);
        },
        async cleanup() {
            await removeDir(FRAME_DIR);
            await removeDir(OUT_DIR);
            await tryDelete(COMPRESSED);
            await tryDelete(OUTPUT);
        },
        terminate() {
            ffmpeg.terminate();
            URL.revokeObjectURL(classWorkerURL);
            URL.revokeObjectURL(coreURL);
            URL.revokeObjectURL(wasmURL);
        }
    };
}
