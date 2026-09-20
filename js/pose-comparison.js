const DEFAULT_OPTIONS = {
    visibilityThreshold: 0.5,
    minComparedWeight: 1.8,
    goodThreshold: 0.82,
    almostThreshold: 0.62
};

const JOINTS = {
    leftShoulder: 11, rightShoulder: 12,
    leftElbow: 13, rightElbow: 14,
    leftWrist: 15, rightWrist: 16,
    leftHip: 23, rightHip: 24,
    leftKnee: 25, rightKnee: 26,
    leftAnkle: 27, rightAnkle: 28
};

const ANGLE_FEATURES = [
    { id: 'leftElbow', label: 'left arm bend', joints: ['leftShoulder', 'leftElbow', 'leftWrist'], weight: 1.2, maxDiff: 95 },
    { id: 'rightElbow', label: 'right arm bend', joints: ['rightShoulder', 'rightElbow', 'rightWrist'], weight: 1.2, maxDiff: 95 },
    { id: 'leftShoulder', label: 'left arm position', joints: ['leftElbow', 'leftShoulder', 'leftHip'], weight: 1.4, maxDiff: 105 },
    { id: 'rightShoulder', label: 'right arm position', joints: ['rightElbow', 'rightShoulder', 'rightHip'], weight: 1.4, maxDiff: 105 },
    { id: 'leftKnee', label: 'left knee bend', joints: ['leftHip', 'leftKnee', 'leftAnkle'], weight: 0.8, maxDiff: 85 },
    { id: 'rightKnee', label: 'right knee bend', joints: ['rightHip', 'rightKnee', 'rightAnkle'], weight: 0.8, maxDiff: 85 }
];

const POSITION_FEATURES = [
    { id: 'leftWristPosition', label: 'left hand position', joint: 'leftWrist', weight: 1.0, maxDistance: 1.25 },
    { id: 'rightWristPosition', label: 'right hand position', joint: 'rightWrist', weight: 1.0, maxDistance: 1.25 },
    { id: 'leftElbowPosition', label: 'left elbow position', joint: 'leftElbow', weight: 0.55, maxDistance: 1.15 },
    { id: 'rightElbowPosition', label: 'right elbow position', joint: 'rightElbow', weight: 0.55, maxDistance: 1.15 },
    { id: 'leftAnklePosition', label: 'left foot position', joint: 'leftAnkle', weight: 0.45, maxDistance: 1.35 },
    { id: 'rightAnklePosition', label: 'right foot position', joint: 'rightAnkle', weight: 0.45, maxDistance: 1.35 }
];

const ORIENTATION_FEATURES = [
    { id: 'torsoLean', label: 'torso lean', from: 'midHip', to: 'midShoulder', weight: 0.8, maxDiff: 55 },
    { id: 'shoulderLine', label: 'shoulder level', from: 'rightShoulder', to: 'leftShoulder', weight: 0.45, maxDiff: 45 }
];

function clonePoint(point) {
    return { x: point.x, y: point.y, z: Number.isFinite(point.z) ? point.z : 0, visibility: point.visibility };
}

function finitePoint(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function visible(point, threshold) {
    return finitePoint(point) && (point.visibility === undefined || point.visibility >= threshold);
}

function average(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2,
        visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1) };
}

function distance(a, b) {
    const dz = (a.z || 0) - (b.z || 0);
    return Math.hypot(a.x - b.x, a.y - b.y, dz * 0.35);
}

function angle(a, b, c) {
    const bax = a.x - b.x, bay = a.y - b.y;
    const bcx = c.x - b.x, bcy = c.y - b.y;
    const denominator = Math.hypot(bax, bay) * Math.hypot(bcx, bcy);
    if (denominator < 1e-6) return null;
    const cosine = Math.max(-1, Math.min(1, (bax * bcx + bay * bcy) / denominator));
    return Math.acos(cosine) * 180 / Math.PI;
}

function vectorAngle(from, to) {
    return Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
}

function angleDifference(a, b) {
    let diff = Math.abs(a - b) % 360;
    if (diff > 180) diff = 360 - diff;
    return diff;
}

function scoreFromDiff(diff, maxDiff) {
    return Math.max(0, 1 - diff / maxDiff);
}

function scoreFromDistance(value, maxDistance) {
    return Math.max(0, 1 - value / maxDistance);
}

function featureRating(score, options) {
    if (score >= options.goodThreshold) return 'good';
    if (score >= options.almostThreshold) return 'almost';
    return 'miss';
}

function pointQuality(reference, player) {
    return Math.min(reference.visibility ?? 1, player.visibility ?? 1);
}

function poseQuality(points, threshold) {
    let visibleCount = 0;
    let usableCount = 0;
    for (const point of points || []) {
        if (!finitePoint(point)) continue;
        usableCount++;
        if (visible(point, threshold)) visibleCount++;
    }
    return { usableCount, visibleCount, visibilityRatio: usableCount ? visibleCount / usableCount : 0 };
}

function getNamed(normalized, name) {
    if (name === 'midHip') return normalized.midHip;
    if (name === 'midShoulder') return normalized.midShoulder;
    return normalized.points[JOINTS[name]];
}

export function normalizePose(landmarks, options = {}) {
    const settings = { ...DEFAULT_OPTIONS, ...options };
    if (!Array.isArray(landmarks)) return null;
    const points = landmarks.map(point => finitePoint(point) ? clonePoint(point) : null);
    const leftHip = points[JOINTS.leftHip];
    const rightHip = points[JOINTS.rightHip];
    const leftShoulder = points[JOINTS.leftShoulder];
    const rightShoulder = points[JOINTS.rightShoulder];
    if (![leftHip, rightHip, leftShoulder, rightShoulder].every(point => visible(point, settings.visibilityThreshold))) {
        return null;
    }

    const midHip = average(leftHip, rightHip);
    const midShoulder = average(leftShoulder, rightShoulder);
    const torso = distance(midHip, midShoulder);
    const shoulderWidth = distance(leftShoulder, rightShoulder);
    const hipWidth = distance(leftHip, rightHip);
    const scale = Math.max(torso, shoulderWidth, hipWidth, 0.0001);
    const normalizedPoints = points.map(point => point ? {
        x: (point.x - midHip.x) / scale,
        y: (point.y - midHip.y) / scale,
        z: ((point.z || 0) - (midHip.z || 0)) / scale,
        visibility: point.visibility
    } : null);

    return {
        points: normalizedPoints,
        midHip: { x: 0, y: 0, z: 0, visibility: midHip.visibility },
        midShoulder: {
            x: (midShoulder.x - midHip.x) / scale,
            y: (midShoulder.y - midHip.y) / scale,
            z: ((midShoulder.z || 0) - (midHip.z || 0)) / scale,
            visibility: midShoulder.visibility
        },
        scale
    };
}

export function comparePoses(referenceLandmarks, playerLandmarks, options = {}) {
    const settings = { ...DEFAULT_OPTIONS, ...options };
    const referenceQuality = poseQuality(referenceLandmarks, settings.visibilityThreshold);
    const playerQuality = poseQuality(playerLandmarks, settings.visibilityThreshold);
    const reference = normalizePose(referenceLandmarks, settings);
    if (!reference) {
        return {
            compared: false,
            skipped: true,
            reason: 'missing-reference',
            similarity: null,
            rating: 'skipped',
            feedback: [],
            comparedWeight: 0,
            referenceQuality,
            playerQuality
        };
    }

    const player = normalizePose(playerLandmarks, settings);
    if (!player) {
        return {
            compared: false,
            skipped: false,
            reason: 'insufficient-player',
            similarity: null,
            rating: 'insufficient',
            feedback: [],
            comparedWeight: 0,
            referenceQuality,
            playerQuality
        };
    }

    const feedback = [];
    let total = 0;
    let weight = 0;

    function include(feature, score, quality, extra = {}) {
        const effectiveWeight = feature.weight * Math.max(0.25, quality);
        feedback.push({ id: feature.id, label: feature.label, score, rating: featureRating(score, settings),
            weight: effectiveWeight, quality, ...extra });
        total += score * effectiveWeight;
        weight += effectiveWeight;
    }

    for (const feature of ANGLE_FEATURES) {
        const [aName, bName, cName] = feature.joints;
        const referencePoints = [getNamed(reference, aName), getNamed(reference, bName), getNamed(reference, cName)];
        const playerPoints = [getNamed(player, aName), getNamed(player, bName), getNamed(player, cName)];
        if (!referencePoints.every(point => visible(point, settings.visibilityThreshold))) continue;
        if (!playerPoints.every(point => visible(point, settings.visibilityThreshold))) continue;
        const referenceAngle = angle(...referencePoints);
        const playerAngle = angle(...playerPoints);
        if (referenceAngle === null || playerAngle === null) continue;
        const diff = angleDifference(referenceAngle, playerAngle);
        include(feature, scoreFromDiff(diff, feature.maxDiff),
            Math.min(...referencePoints.map((point, index) => pointQuality(point, playerPoints[index]))),
            { differenceDegrees: diff });
    }

    for (const feature of POSITION_FEATURES) {
        const referencePoint = getNamed(reference, feature.joint);
        const playerPoint = getNamed(player, feature.joint);
        if (!visible(referencePoint, settings.visibilityThreshold) || !visible(playerPoint, settings.visibilityThreshold)) continue;
        const value = distance(referencePoint, playerPoint);
        include(feature, scoreFromDistance(value, feature.maxDistance), pointQuality(referencePoint, playerPoint),
            { distance: value });
    }

    for (const feature of ORIENTATION_FEATURES) {
        const referenceFrom = getNamed(reference, feature.from);
        const referenceTo = getNamed(reference, feature.to);
        const playerFrom = getNamed(player, feature.from);
        const playerTo = getNamed(player, feature.to);
        if (![referenceFrom, referenceTo, playerFrom, playerTo].every(point => visible(point, settings.visibilityThreshold))) continue;
        const diff = angleDifference(vectorAngle(referenceFrom, referenceTo), vectorAngle(playerFrom, playerTo));
        include(feature, scoreFromDiff(diff, feature.maxDiff),
            Math.min(pointQuality(referenceFrom, playerFrom), pointQuality(referenceTo, playerTo)),
            { differenceDegrees: diff });
    }

    if (weight < settings.minComparedWeight) {
        return {
            compared: false,
            skipped: false,
            reason: 'not-enough-comparable-features',
            similarity: null,
            rating: 'insufficient',
            feedback,
            comparedWeight: weight,
            referenceQuality,
            playerQuality
        };
    }

    const similarity = total / weight;
    return {
        compared: true,
        skipped: false,
        reason: null,
        similarity,
        rating: featureRating(similarity, settings),
        feedback: feedback.sort((a, b) => a.score - b.score),
        comparedWeight: weight,
        referenceQuality,
        playerQuality
    };
}
