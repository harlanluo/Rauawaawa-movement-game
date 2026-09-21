import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPoseScoringSession, findReferenceFrames } from '../js/pose-scoring.js';

function pose(marker = 0) {
    return Array.from({ length: 33 }, (_, index) => ({
        x: 0.4 + marker + index * 0.001,
        y: 0.3 + index * 0.01,
        z: 0,
        visibility: 1
    }));
}

test('reference lookup returns only nearby frames ordered by distance', () => {
    const frames = [0, 100, 200, 300, 400].map(timeMs => ({ timeMs, landmarks: pose() }));
    assert.deepEqual(findReferenceFrames(frames, 240, 120).map(frame => frame.timeMs), [200, 300]);
});

test('session chooses the best pose inside the temporal tolerance window', () => {
    const player = pose();
    const session = createPoseScoringSession({ frames: [
        { timeMs: 900, landmarks: pose(0.2) },
        { timeMs: 1000, landmarks: player },
        { timeMs: 1100, landmarks: pose(-0.2) }
    ] }, {
        comparePoses: (reference, candidate) => ({
            compared: true,
            similarity: reference === candidate ? 1 : 0.4,
            rating: reference === candidate ? 'good' : 'miss',
            feedback: []
        })
    });
    const update = session.update(1050, player);
    assert.equal(update.referenceTimeMs, 1000);
    assert.equal(update.score, 10);
    assert.equal(update.averageSimilarity, 1);
});

test('repeated updates in one score interval keep the best result', () => {
    let similarity = 0.5;
    const session = createPoseScoringSession({ frames: [{ timeMs: 100, landmarks: pose() }] }, {
        toleranceMs: 500,
        scoreIntervalMs: 500,
        comparePoses: () => ({ compared: true, similarity, rating: 'almost', feedback: [] })
    });
    assert.equal(session.update(100, pose()).score, 5);
    similarity = 0.9;
    assert.equal(session.update(200, pose()).score, 9);
    similarity = 0.4;
    const update = session.update(300, pose());
    assert.equal(update.score, 9);
    assert.equal(update.sampleCount, 1);
});

test('score accumulates across intervals and never removes earned points', () => {
    let similarity = 0.9;
    const session = createPoseScoringSession({ frames: [
        { timeMs: 100, landmarks: pose() },
        { timeMs: 600, landmarks: pose() }
    ] }, {
        toleranceMs: 100,
        scoreIntervalMs: 500,
        comparePoses: () => ({ compared: true, similarity, rating: 'almost', feedback: [] })
    });

    assert.equal(session.update(100, pose()).score, 9);
    similarity = 0.4;
    const update = session.update(600, pose());
    assert.equal(update.score, 13);
    assert.equal(update.averageSimilarity, 0.65);
    assert.equal(update.sampleCount, 2);
});

test('missing reference windows and insufficient player data do not add score samples', () => {
    const session = createPoseScoringSession({ frames: [{ timeMs: 0, landmarks: null }] }, {
        toleranceMs: 100
    });
    const missing = session.update(0, pose());
    assert.equal(missing.result.rating, 'skipped');
    assert.equal(missing.sampleCount, 0);
    const outside = session.update(1000, pose());
    assert.equal(outside.result.rating, 'skipped');
    assert.equal(outside.sampleCount, 0);
});

test('insufficient player result takes priority over a nearby missing reference frame', () => {
    const lowVisibilityPlayer = pose().map(point => ({ ...point, visibility: 0.1 }));
    const session = createPoseScoringSession({ frames: [
        { timeMs: 0, landmarks: null },
        { timeMs: 100, landmarks: pose() }
    ] }, { toleranceMs: 150 });
    const update = session.update(0, lowVisibilityPlayer);
    assert.equal(update.result.rating, 'insufficient');
    assert.equal(update.sampleCount, 0);
});
