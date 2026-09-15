// Stylized feedback only: no scoring or demonstration-video comparison.
function createAvatarPoseController(avatar) {
    let candidate = 'neutral';
    let candidateSince = null;
    const stableMs = 200;

    function reset() {
        candidate = 'neutral';
        candidateSince = null;
        avatar.dataset.pose = 'neutral';
    }

    function reliable(point) {
        return point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
            (point.visibility === undefined || point.visibility >= 0.6);
    }

    function update(landmarks, timestamp) {
        // MediaPipe anatomical left drives screen-left, like a mirror.
        // Shoulder-relative thresholds also work with seated players; legs are not required.
        const leftShoulder = landmarks?.[11];
        const rightShoulder = landmarks?.[12];
        const leftWrist = landmarks?.[15];
        const rightWrist = landmarks?.[16];
        if (![leftShoulder, rightShoulder, leftWrist, rightWrist].every(reliable)) {
            reset();
            return;
        }
        const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
        if (shoulderWidth < 0.04) { reset(); return; }
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

    reset();
    return { update, reset };
}
