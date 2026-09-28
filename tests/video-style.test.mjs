import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORY, CLOTHES_COLOR, PERSON_COLOR, coverRect, stylizeFrame } from '../video_style/stylize.js';
import { LIMITS, sampleTimes, targetSize } from '../video_style/media.js';

function solidBackground(width, height, rgb) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
    return data;
}

function pixelAt(data, width, x, y) {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

test('clothes become blue, other person classes red, background shows through', () => {
    const mask = Uint8Array.from([
        CATEGORY.BACKGROUND, CATEGORY.HAIR, CATEGORY.BODY_SKIN,
        CATEGORY.FACE_SKIN, CATEGORY.CLOTHES, CATEGORY.ACCESSORIES
    ]);
    const background = solidBackground(3, 2, [10, 20, 30]);
    const out = stylizeFrame({ mask, background, width: 3, height: 2 });
    assert.deepEqual(pixelAt(out, 3, 0, 0), [10, 20, 30, 255]);
    assert.deepEqual(pixelAt(out, 3, 1, 0), [...PERSON_COLOR, 255]);
    assert.deepEqual(pixelAt(out, 3, 2, 0), [...PERSON_COLOR, 255]);
    assert.deepEqual(pixelAt(out, 3, 0, 1), [...PERSON_COLOR, 255]);
    assert.deepEqual(pixelAt(out, 3, 1, 1), [...CLOTHES_COLOR, 255]);
    assert.deepEqual(pixelAt(out, 3, 2, 1), [...PERSON_COLOR, 255]);
});

test('palette colors are the specified primaries', () => {
    assert.deepEqual([...CLOTHES_COLOR], [0x00, 0x47, 0xff]);
    assert.deepEqual([...PERSON_COLOR], [0xe1, 0x06, 0x00]);
});

test('lower-resolution mask is sampled nearest-neighbour onto the frame', () => {
    const mask = Uint8Array.from([CATEGORY.BACKGROUND, CATEGORY.CLOTHES]); // 2x1
    const background = solidBackground(4, 2, [1, 2, 3]);
    const out = stylizeFrame({ mask, maskWidth: 2, maskHeight: 1, background, width: 4, height: 2 });
    for (const y of [0, 1]) {
        assert.deepEqual(pixelAt(out, 4, 0, y), [1, 2, 3, 255]);
        assert.deepEqual(pixelAt(out, 4, 1, y), [1, 2, 3, 255]);
        assert.deepEqual(pixelAt(out, 4, 2, y), [...CLOTHES_COLOR, 255]);
        assert.deepEqual(pixelAt(out, 4, 3, y), [...CLOTHES_COLOR, 255]);
    }
});

test('stylize writes into a provided buffer and rejects undersized inputs', () => {
    const out = new Uint8ClampedArray(4);
    const result = stylizeFrame({ mask: Uint8Array.of(CATEGORY.CLOTHES), background: solidBackground(1, 1, [0, 0, 0]), width: 1, height: 1, out });
    assert.equal(result, out);
    assert.throws(() => stylizeFrame({ mask: new Uint8Array(1), background: new Uint8ClampedArray(16), width: 2, height: 2 }));
    assert.throws(() => stylizeFrame({ mask: new Uint8Array(4), background: new Uint8ClampedArray(4), width: 2, height: 2 }));
});

test('coverRect crops the long axis and keeps the aspect ratio', () => {
    assert.deepEqual(coverRect(2000, 1000, 640, 640), { sx: 500, sy: 0, sw: 1000, sh: 1000 });
    assert.deepEqual(coverRect(1000, 1000, 640, 360), { sx: 0, sy: 218.75, sw: 1000, sh: 562.5 });
    const rect = coverRect(1920, 1080, 360, 640);
    assert.ok(Math.abs(rect.sw / rect.sh - 360 / 640) < 1e-9);
    assert.equal(rect.sy, 0);
});

test('targetSize caps width, keeps aspect ratio and even dimensions, never upscales', () => {
    assert.deepEqual(targetSize(3840, 2160), { width: 640, height: 360 });
    assert.deepEqual(targetSize(1080, 1920), { width: 640, height: 1136 });
    assert.deepEqual(targetSize(480, 270), { width: 480, height: 270 });
    assert.deepEqual(targetSize(481, 271), { width: 480, height: 270 });
    const { width, height } = targetSize(1920, 1080, LIMITS.maxWidth);
    assert.equal(width % 2 + height % 2, 0);
});

test('sampleTimes emits one timestamp per output frame, capped at the time limit', () => {
    assert.deepEqual(sampleTimes(0.2, 15), [0, 1 / 15, 2 / 15]);
    assert.equal(sampleTimes(10, 15).length, 150);
    assert.equal(sampleTimes(300, LIMITS.fps, LIMITS.maxSeconds).length, LIMITS.fps * LIMITS.maxSeconds);
    assert.ok(sampleTimes(300).at(-1) < LIMITS.maxSeconds);
    assert.deepEqual(sampleTimes(0), []);
    assert.deepEqual(sampleTimes(Number.NaN), []);
    assert.deepEqual(sampleTimes(0.01), [0]);
});
