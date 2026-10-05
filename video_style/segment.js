const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs';
const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

export async function createSegmenter({ forceCPU = false } = {}) {
    const { FilesetResolver, ImageSegmenter } = await import(VISION_URL);
    const files = await FilesetResolver.forVisionTasks(WASM_ROOT);
    let model = null;
    let delegate = null;
    for (const candidate of forceCPU ? ['CPU'] : ['GPU', 'CPU']) {
        try {
            model = await ImageSegmenter.createFromOptions(files, {
                baseOptions: { modelAssetPath: MODEL_URL, delegate: candidate },
                runningMode: 'VIDEO', outputCategoryMask: true, outputConfidenceMasks: false
            });
            delegate = candidate;
            break;
        } catch (error) {
            console.warn(`Segmenter ${candidate} initialization failed (${MODEL_URL})`, error);
            if (candidate === 'CPU') throw error;
        }
    }
    // VIDEO mode requires strictly increasing timestamps for the model's lifetime,
    // so later videos continue from where the previous one stopped.
    let lastTimestamp = -1;

    return {
        delegate,
        // Returns a copy of the category mask; the MediaPipe result is released immediately.
        segment(image, timestampMs) {
            const timestamp = Math.max(Math.round(timestampMs), lastTimestamp + 1);
            lastTimestamp = timestamp;
            const result = model.segmentForVideo(image, timestamp);
            try {
                const mask = result.categoryMask;
                if (!mask) throw new Error('Segmenter returned no category mask');
                return { mask: mask.getAsUint8Array().slice(), width: mask.width, height: mask.height };
            } finally {
                result.close();
            }
        },
        nextTimestampBase() {
            return lastTimestamp + 1;
        },
        close() {
            model?.close();
            model = null;
        }
    };
}
