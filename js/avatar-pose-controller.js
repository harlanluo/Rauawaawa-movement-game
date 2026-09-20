// Continuous articulated avatar feedback only; scoring remains in pose-comparison.js.
function createAvatarPoseController(avatar) {
    const stableMs = 200;
    const smoothing = 0.35;
    const jointIndexes = {
        nose: 0,
        leftShoulder: 11, rightShoulder: 12,
        leftElbow: 13, rightElbow: 14,
        leftWrist: 15, rightWrist: 16,
        leftHip: 23, rightHip: 24,
        leftKnee: 25, rightKnee: 26,
        leftAnkle: 27, rightAnkle: 28
    };
    const segmentNames = [
        ['leftUpperArm', 'leftShoulder', 'leftElbow'],
        ['leftForearm', 'leftElbow', 'leftWrist'],
        ['rightUpperArm', 'rightShoulder', 'rightElbow'],
        ['rightForearm', 'rightElbow', 'rightWrist'],
        ['leftThigh', 'leftHip', 'leftKnee'],
        ['leftShin', 'leftKnee', 'leftAnkle'],
        ['rightThigh', 'rightHip', 'rightKnee'],
        ['rightShin', 'rightKnee', 'rightAnkle']
    ];
    const elements = {};
    const defaults = new Map();
    let candidate = 'neutral';
    let candidateSince = null;
    let smoothed = {};

    for (const [id] of segmentNames) elements[id] = avatar.querySelector?.(`#${id}`) || null;
    for (const name of Object.keys(jointIndexes)) elements[`${name}Joint`] = avatar.querySelector?.(`#${name}Joint`) || null;
    elements.torso = avatar.querySelector?.('#avatarTorso') || null;
    elements.head = avatar.querySelector?.('#avatarHead') || null;

    for (const element of Object.values(elements)) {
        if (!element) continue;
        const snapshot = {};
        for (const attribute of ['x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'points', 'opacity']) {
            const value = element.getAttribute?.(attribute);
            if (value !== null && value !== undefined) snapshot[attribute] = value;
        }
        if (snapshot.opacity === undefined) snapshot.opacity = '1';
        defaults.set(element, snapshot);
    }

    function reliable(point, threshold = 0.5) {
        return point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
            (point.visibility === undefined || point.visibility >= threshold);
    }

    function setAttributes(element, attributes) {
        if (!element) return;
        for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
    }

    function restoreDefaults() {
        for (const [element, attributes] of defaults) setAttributes(element, attributes);
    }

    function reset() {
        candidate = 'neutral';
        candidateSince = null;
        smoothed = {};
        avatar.dataset.pose = 'neutral';
        restoreDefaults();
    }

    function updatePoseLabel(points, timestamp) {
        const leftShoulder = points.leftShoulder;
        const rightShoulder = points.rightShoulder;
        const leftWrist = points.leftWrist;
        const rightWrist = points.rightWrist;
        const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
        if (shoulderWidth < 0.04) return;
        const leftUp = leftWrist.y < leftShoulder.y - shoulderWidth * 0.3;
        const rightUp = rightWrist.y < rightShoulder.y - shoulderWidth * 0.3;
        const center = (leftShoulder.x + rightShoulder.x) / 2;
        const open = [leftWrist, rightWrist].every((wrist, index) => {
            const shoulder = index === 0 ? leftShoulder : rightShoulder;
            return (wrist.x - center) * (shoulder.x - center) > 0 &&
                Math.abs(wrist.x - center) > shoulderWidth * 1.3 &&
                Math.abs(wrist.y - shoulder.y) < shoulderWidth * 0.65;
        });
        const next = leftUp && rightUp ? 'bothHandsUp' : leftUp ? 'leftHandUp' :
            rightUp ? 'rightHandUp' : open ? 'armsOpen' : 'neutral';
        if (next !== candidate || candidateSince === null) {
            candidate = next;
            candidateSince = timestamp;
        }
        if (timestamp - candidateSince >= stableMs) avatar.dataset.pose = next;
    }

    function update(landmarks, timestamp) {
        const raw = {};
        for (const [name, index] of Object.entries(jointIndexes)) raw[name] = landmarks?.[index];
        const coreNames = ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'];
        if (!coreNames.every(name => reliable(raw[name]))) {
            reset();
            return;
        }

        const midHip = {
            x: (raw.leftHip.x + raw.rightHip.x) / 2,
            y: (raw.leftHip.y + raw.rightHip.y) / 2
        };
        const midShoulder = {
            x: (raw.leftShoulder.x + raw.rightShoulder.x) / 2,
            y: (raw.leftShoulder.y + raw.rightShoulder.y) / 2
        };
        const torsoLength = Math.hypot(midShoulder.x - midHip.x, midShoulder.y - midHip.y);
        const shoulderWidth = Math.hypot(
            raw.leftShoulder.x - raw.rightShoulder.x,
            raw.leftShoulder.y - raw.rightShoulder.y
        );
        const scale = 88 / Math.max(torsoLength, shoulderWidth, 0.08);
        const mapped = {};

        for (const [name, point] of Object.entries(raw)) {
            if (!reliable(point)) continue;
            const target = {
                x: 100 - (point.x - midHip.x) * scale,
                y: 184 + (point.y - midHip.y) * scale
            };
            const previous = smoothed[name];
            mapped[name] = previous ? {
                x: previous.x + (target.x - previous.x) * smoothing,
                y: previous.y + (target.y - previous.y) * smoothing
            } : target;
        }
        smoothed = mapped;

        for (const [id, fromName, toName] of segmentNames) {
            const from = mapped[fromName];
            const to = mapped[toName];
            setAttributes(elements[id], from && to
                ? { x1: from.x, y1: from.y, x2: to.x, y2: to.y, opacity: 1 }
                : { opacity: 0.18 });
        }
        for (const name of Object.keys(jointIndexes)) {
            const point = mapped[name];
            setAttributes(elements[`${name}Joint`], point
                ? { cx: point.x, cy: point.y, opacity: 1 }
                : { opacity: 0.18 });
        }

        const torsoPoints = ['leftShoulder', 'rightShoulder', 'rightHip', 'leftHip']
            .map(name => mapped[name]);
        if (torsoPoints.every(Boolean)) {
            setAttributes(elements.torso, {
                points: torsoPoints.map(point => `${point.x},${point.y}`).join(' '),
                opacity: 1
            });
        }
        const headCenter = mapped.nose || {
            x: (mapped.leftShoulder.x + mapped.rightShoulder.x) / 2,
            y: (mapped.leftShoulder.y + mapped.rightShoulder.y) / 2 - 42
        };
        setAttributes(elements.head, { cx: headCenter.x, cy: headCenter.y, r: 23, opacity: 1 });

        if (['leftShoulder', 'rightShoulder', 'leftWrist', 'rightWrist'].every(name => reliable(raw[name], 0.6))) {
            updatePoseLabel(raw, timestamp);
        } else {
            candidate = 'neutral';
            candidateSince = null;
            avatar.dataset.pose = 'neutral';
        }
    }

    reset();
    return { update, reset };
}
