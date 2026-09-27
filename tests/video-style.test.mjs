import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORY, CLOTHES_COLOR, PERSON_COLOR, coverRect, stylizeFrame } from '../video_style/stylize.js';
import { compressArgs, encodeArgs, extractFramesArgs, framePath, inputName, LIMITS } from '../video_style/transcode.js';

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

test('compress args cap duration, frame rate and width', () => {
    const args = compressArgs('input.mov');
    assert.deepEqual(args.slice(0, 4), ['-i', 'input.mov', '-t', String(LIMITS.maxSeconds)]);
    const filter = args[args.indexOf('-vf') + 1];
    assert.match(filter, /^fps=15,/);
    assert.match(filter, /min\(640,iw\)/);
    assert.match(filter, /:-2$/);
    assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
    assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
    assert.equal(args.at(-1), 'compressed.mp4');
});

test('frame extraction and encode args agree on the frame naming pattern', () => {
    assert.equal(extractFramesArgs().at(-1), 'frames/f_%05d.jpg');
    const args = encodeArgs();
    assert.equal(args[args.indexOf('-framerate') + 1], '15');
    assert.equal(args[args.indexOf('-i') + 1], 'out/f_%05d.jpg');
    assert.ok(args.includes('1:a?'), 'audio mapping must be optional');
    assert.equal(args[args.indexOf('-pix_fmt') + 1], 'yuv420p');
    assert.equal(args.at(-1), 'stylized.mp4');
    assert.equal(framePath('frames', 7), 'frames/f_00007.jpg');
});

test('input file names keep a safe extension', () => {
    assert.equal(inputName('My Clip.MOV'), 'input.mov');
    assert.equal(inputName('clip.webm'), 'input.webm');
    assert.equal(inputName('no-extension'), 'input.mp4');
});
