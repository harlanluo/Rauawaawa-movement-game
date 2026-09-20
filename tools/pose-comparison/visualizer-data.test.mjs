import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerPose, formatResult } from './visualizer-data.mjs';

function pose() {
  return Array.from({ length: 33 }, (_, index) => ({
    x: 0.25 + index * 0.01,
    y: 0.2 + index * 0.015,
    z: index * 0.001,
    visibility: 1
  }));
}

test('player simulation applies framing without mutating the reference', () => {
  const reference = pose();
  const player = createPlayerPose(reference, { translatePercent: 10, scalePercent: 80 });
  assert.equal(reference[0].x, 0.25);
  assert.equal(player[0].x, 0.4);
  assert.equal(player[0].y, 0.26);
  assert.equal(player[0].z, 0);
});

test('player simulation can hide all lower-body anchors', () => {
  const player = createPlayerPose(pose(), { hideLowerBody: true });
  assert.equal(player[22].visibility, 1);
  for (let index = 23; index <= 32; index++) assert.equal(player[index].visibility, 0);
});

test('result formatter handles compared and skipped results', () => {
  assert.deepEqual(formatResult({ similarity: 0.836, rating: 'good', comparedWeight: 4.567 }), {
    similarity: '84%', rating: 'Good', weight: '4.57'
  });
  assert.equal(formatResult(null).rating, '—');
});
