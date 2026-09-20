import { comparePoses } from './pose-comparison.js';

const DEFAULT_OPTIONS = {
    toleranceMs: 300,
    scoreIntervalMs: 500
};

function validTime(value) {
    return Number.isFinite(value) && value >= 0;
}

function lowerBound(frames, timeMs) {
    let low = 0;
    let high = frames.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (frames[middle].timeMs < timeMs) low = middle + 1;
        else high = middle;
    }
    return low;
}

function resultPriority(result) {
    if (result.compared) return 2;
    if (result.rating === 'insufficient') return 1;
    return 0;
}

export function findReferenceFrames(frames, timeMs, toleranceMs = DEFAULT_OPTIONS.toleranceMs) {
    if (!Array.isArray(frames) || !validTime(timeMs) || !Number.isFinite(toleranceMs) || toleranceMs < 0) return [];
    const start = lowerBound(frames, timeMs - toleranceMs);
    const matches = [];
    for (let index = start; index < frames.length; index++) {
        const frame = frames[index];
        if (!validTime(frame?.timeMs)) continue;
        if (frame.timeMs > timeMs + toleranceMs) break;
        matches.push(frame);
    }
    return matches.sort((a, b) => Math.abs(a.timeMs - timeMs) - Math.abs(b.timeMs - timeMs));
}

export function createPoseScoringSession(referenceData, options = {}) {
    const settings = { ...DEFAULT_OPTIONS, ...options };
    const frames = referenceData?.frames;
    if (!Array.isArray(frames) || frames.length === 0) {
        throw new TypeError('Reference pose data must contain frames.');
    }
    if (!Number.isFinite(settings.scoreIntervalMs) || settings.scoreIntervalMs <= 0) {
        throw new TypeError('scoreIntervalMs must be greater than zero.');
    }

    const compare = settings.comparePoses || comparePoses;
    const scoresByBucket = new Map();
    let latest = null;

    function getSummary() {
        const scores = [...scoresByBucket.values()];
        const similarity = scores.length
            ? scores.reduce((total, value) => total + value, 0) / scores.length
            : null;
        return {
            score: similarity === null ? 0 : Math.round(similarity * 100),
            averageSimilarity: similarity,
            sampleCount: scores.length
        };
    }

    function update(timeMs, playerLandmarks) {
        if (!validTime(timeMs)) return { ...getSummary(), result: null, referenceTimeMs: null };
        const candidates = findReferenceFrames(frames, timeMs, settings.toleranceMs);
        let selected = null;

        for (const frame of candidates) {
            const result = compare(frame.landmarks, playerLandmarks, settings.comparisonOptions);
            const priority = resultPriority(result);
            const selectedPriority = selected ? resultPriority(selected.result) : -1;
            if (!selected || priority > selectedPriority ||
                (result.compared && selected.result.compared && result.similarity > selected.result.similarity)) {
                selected = { result, referenceTimeMs: frame.timeMs };
            }
        }

        if (!selected) {
            selected = { result: compare(null, playerLandmarks, settings.comparisonOptions), referenceTimeMs: null };
        }

        latest = selected;
        if (selected.result.compared) {
            const bucket = Math.floor(timeMs / settings.scoreIntervalMs);
            const previous = scoresByBucket.get(bucket);
            if (previous === undefined || selected.result.similarity > previous) {
                scoresByBucket.set(bucket, selected.result.similarity);
            }
        }

        return { ...getSummary(), ...selected };
    }

    return Object.freeze({
        update,
        getSummary,
        getLatest: () => latest
    });
}
