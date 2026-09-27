// Pure, DOM-free compositing for the video stylization prototype.
// selfie_multiclass_256x256 categories:
// 0 background, 1 hair, 2 body-skin, 3 face-skin, 4 clothes, 5 accessories.
export const CATEGORY = Object.freeze({
    BACKGROUND: 0, HAIR: 1, BODY_SKIN: 2, FACE_SKIN: 3, CLOTHES: 4, ACCESSORIES: 5
});

export const CLOTHES_COLOR = Object.freeze([0x00, 0x47, 0xff]);
export const PERSON_COLOR = Object.freeze([0xe1, 0x06, 0x00]);

// Category index -> [r, g, b], or null to show the background.
export const DEFAULT_PALETTE = Object.freeze([
    null,
    PERSON_COLOR,
    PERSON_COLOR,
    PERSON_COLOR,
    CLOTHES_COLOR,
    PERSON_COLOR
]);

// Source rectangle to crop so an srcW×srcH image covers dstW×dstH without distortion.
export function coverRect(srcW, srcH, dstW, dstH) {
    const scale = Math.max(dstW / srcW, dstH / srcH);
    const sw = dstW / scale;
    const sh = dstH / scale;
    return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
}

// Writes RGBA into `out` (length width*height*4). The mask may be a different
// resolution than the output; it is sampled nearest-neighbour.
export function stylizeFrame({
    mask, maskWidth = null, maskHeight = null,
    background, width, height,
    palette = DEFAULT_PALETTE, out = new Uint8ClampedArray(width * height * 4)
}) {
    const mw = maskWidth ?? width;
    const mh = maskHeight ?? height;
    if (mask.length < mw * mh) throw new Error('Mask is smaller than its stated dimensions');
    if (background.length < width * height * 4) throw new Error('Background is smaller than the frame');
    const sameSize = mw === width && mh === height;
    let pixel = 0;
    for (let y = 0; y < height; y++) {
        const maskRow = sameSize ? y * mw : Math.min(mh - 1, Math.floor((y + 0.5) * mh / height)) * mw;
        for (let x = 0; x < width; x++, pixel += 4) {
            const maskIndex = sameSize ? maskRow + x : maskRow + Math.min(mw - 1, Math.floor((x + 0.5) * mw / width));
            const color = palette[mask[maskIndex]];
            if (color) {
                out[pixel] = color[0];
                out[pixel + 1] = color[1];
                out[pixel + 2] = color[2];
            } else {
                out[pixel] = background[pixel];
                out[pixel + 1] = background[pixel + 1];
                out[pixel + 2] = background[pixel + 2];
            }
            out[pixel + 3] = 255;
        }
    }
    return out;
}
