import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparePoses, normalizePose } from '../js/pose-comparison.js';

function basePose({ offsetX = 0, offsetY = 0, scale = 1, visibility = 1 } = {}) {
    const points = Array.from({ length: 33 }, () => ({ x: offsetX + 0.5 * scale, y: offsetY + 0.5 * scale, z: 0, visibility }));
    const set = (index, x, y, z = 0, pointVisibility = visibility) => {
        points[index] = { x: offsetX + x * scale, y: offsetY + y * scale, z: z * scale, visibility: pointVisibility };
    };
    set(11, 0.42, 0.30); set(12, 0.58, 0.30);
    set(13, 0.34, 0.46); set(14, 0.66, 0.46);
    set(15, 0.30, 0.62); set(16, 0.70, 0.62);
    set(23, 0.44, 0.58); set(24, 0.56, 0.58);
    set(25, 0.43, 0.78); set(26, 0.57, 0.78);
    set(27, 0.42, 0.96); set(28, 0.58, 0.96);
    return points;
}

function bothHandsUp() {
    const points = basePose();
    points[13] = { x: 0.36, y: 0.16, z: 0, visibility: 1 };
    points[14] = { x: 0.64, y: 0.16, z: 0, visibility: 1 };
    points[15] = { x: 0.34, y: 0.02, z: 0, visibility: 1 };
    points[16] = { x: 0.66, y: 0.02, z: 0, visibility: 1 };
    return points;
}

test('normalization removes camera framing and body scale differences', () => {
    const reference = basePose();
    const player = basePose({ offsetX: 0.2, offsetY: -0.15, scale: 1.8 });
    const referenceNorm = normalizePose(reference);
    const playerNorm = normalizePose(player);
    assert.ok(referenceNorm);
    assert.ok(playerNorm);
    assert.equal(referenceNorm.points[15].x.toFixed(4), playerNorm.points[15].x.toFixed(4));
    const result = comparePoses(reference, player);
    assert.equal(result.compared, true);
    assert.equal(result.rating, 'good');
    assert.ok(result.similarity > 0.99);
});

test('arm mismatch lowers the score and reports the weakest body features first', () => {
    const result = comparePoses(bothHandsUp(), basePose());
    assert.equal(result.compared, true);
    assert.equal(result.rating, 'miss');
    assert.ok(result.similarity < 0.55);
    assert.match(result.feedback[0].id, /Wrist|Shoulder|Elbow/);
});

test('missing reference pose is skipped without penalising the player', () => {
    const result = comparePoses(null, basePose());
    assert.equal(result.compared, false);
    assert.equal(result.skipped, true);
    assert.equal(result.rating, 'skipped');
    assert.equal(result.reason, 'missing-reference');
    assert.equal(result.similarity, null);
});

test('insufficient player landmarks are reported separately from bad movement', () => {
    const player = basePose({ visibility: 0.1 });
    const result = comparePoses(basePose(), player);
    assert.equal(result.compared, false);
    assert.equal(result.skipped, false);
    assert.equal(result.rating, 'insufficient');
    assert.equal(result.reason, 'insufficient-player');
});

test('low-visibility optional joints are ignored instead of dragging down the score', () => {
    const reference = bothHandsUp();
    const player = bothHandsUp();
    player[15].visibility = 0.1;
    player[16].visibility = 0.1;
    const result = comparePoses(reference, player, { minComparedWeight: 1.0 });
    assert.equal(result.compared, true);
    assert.equal(result.rating, 'good');
    assert.ok(result.feedback.every(item => !item.id.includes('WristPosition')));
});

test('partially comparable poses return insufficient when too little remains', () => {
    const reference = bothHandsUp();
    const player = bothHandsUp();
    for (const index of [13, 14, 15, 16, 25, 26, 27, 28]) player[index].visibility = 0.1;
    const result = comparePoses(reference, player);
    assert.equal(result.compared, false);
    assert.equal(result.reason, 'not-enough-comparable-features');
    assert.ok(result.comparedWeight < 1.8);
});

test('seated mode compares upper-body movement without visible hips or legs', () => {
    const reference = bothHandsUp();
    const player = bothHandsUp();
    for (const index of [23, 24, 25, 26, 27, 28]) player[index].visibility = 0.1;
    const result = comparePoses(reference, player, { bodyMode: 'seated' });
    assert.equal(result.compared, true);
    assert.equal(result.rating, 'good');
    assert.ok(result.similarity > 0.99);
    assert.ok(result.feedback.every(item => !item.id.includes('Knee') && !item.id.includes('Ankle')));
});

test('standing mode still requires shoulder and hip anchors for full-body scoring', () => {
    const player = bothHandsUp();
    player[23].visibility = 0.1;
    player[24].visibility = 0.1;
    const result = comparePoses(bothHandsUp(), player, { bodyMode: 'standing' });
    assert.equal(result.compared, false);
    assert.equal(result.rating, 'insufficient');
});
