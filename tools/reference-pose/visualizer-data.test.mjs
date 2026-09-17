import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { validateReference, nearestSample, matchingTolerance, missingRanges, CONNECTIONS } from './visualizer-data.mjs';

const real = JSON.parse(fs.readFileSync(new URL('../../assets/games/demo-standing/reference-pose.json', import.meta.url)));
test('file protocol displays localhost instructions without importing the visualizer', () => {
  const html = fs.readFileSync(new URL('./visualizer.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const status = {};
  vm.runInNewContext(script, { location: { protocol: 'file:' },
    document: { getElementById: () => status } });
  assert.match(status.textContent, /python -m http.server 8000/);
  assert.match(status.textContent, /http:\/\/localhost:8000/);
  assert.equal(status.className, 'error');
});
test('real dataset validates and missing groups cover exactly all missing poses', () => {
  assert.equal(validateReference(real), real);
  assert.equal(real.frames.length, 732);
  const ranges = missingRanges(real.frames);
  assert.equal(ranges.reduce((sum, r) => sum + r.count, 0), 291);
  assert.equal(real.frames.filter(f => f.landmarks !== null).length, 441);
  assert.equal(CONNECTIONS.length, 35);
  assert.ok(CONNECTIONS.flat().every(i => i >= 0 && i < 33));
});
test('optional coverage validates boundaries, partition and missing inactive samples', () => {
  const legacy = structuredClone(real);
  delete legacy.coverage; delete legacy.usableRanges;
  assert.equal(validateReference(legacy), legacy);
  assert.deepEqual(real.usableRanges, [{startMs:0, endMs:57733}]);
  for (const mutate of [d=>d.usableRanges[0].endMs++, d=>d.usableRanges[0].startMs=-1,
    d=>d.coverage.inactiveRanges[0].endMs++, d=>d.coverage.inactiveRanges=[],
    d=>d.coverage.rangeConvention='closed', d=>delete d.usableRanges,
    d=>d.frames.at(-1).landmarks=d.frames[0].landmarks]) {
    const bad = structuredClone(real); mutate(bad);
    assert.throws(() => validateReference(bad));
  }
});
test('nearest lookup handles exact, between, tie, first and last timestamps', () => {
  const frames = [0, 100, 200].map(timeMs => ({ timeMs }));
  for (const [time, index] of [[0,0],[40,0],[50,0],[51,1],[100,1],[200,2],[220,2]]) {
    assert.equal(nearestSample(frames, time, 60).index, index);
  }
  assert.equal(nearestSample(frames, 160, 60).deltaMs, 40);
});
test('tolerance rejects distant frames and gaps rather than reusing a stale pose', () => {
  const frames = [{timeMs: 100}, {timeMs: 1000}];
  assert.equal(nearestSample(frames, 500, 84), null);
  assert.equal(nearestSample(frames, 15, 84), null);
  assert.equal(nearestSample(frames, 1085, 84), null);
  assert.equal(nearestSample(frames, 16, 84).index, 0);
  assert.equal(nearestSample([], 0, 84), null);
  assert.equal(nearestSample(frames, NaN, 84), null);
  assert.ok(Math.abs(matchingTolerance(real) - 84.333) < .01);
});
test('missing groups preserve isolated samples and leading/trailing runs', () => {
  const frames = [null,null,[],null,[],null,null].map((landmarks,i) => ({timeMs:i*100,landmarks}));
  assert.deepEqual(missingRanges(frames), [
    {startIndex:0,endIndex:1,startMs:0,endMs:100,count:2},
    {startIndex:3,endIndex:3,startMs:300,endMs:300,count:1},
    {startIndex:5,endIndex:6,startMs:500,endMs:600,count:2}]);
  assert.deepEqual(missingRanges([]), []);
  assert.deepEqual(missingRanges([{timeMs:0,landmarks:[]}]), []);
});
test('malformed metadata, timestamps, landmarks and missing representation fail closed', () => {
  const mutations = [d=>d.formatVersion=2, d=>delete d.sourceVideo, d=>d.sourceVideo='wrong.mp4',
    d=>delete d.frames, d=>d.frames=[], d=>d.video.width=0, d=>d.sampling.targetFps=NaN,
    d=>d.frames[1].timeMs=d.frames[0].timeMs, d=>d.frames[0].timeMs=-1,
    d=>d.frames.at(-1).timeMs=d.video.durationMs, d=>delete d.frames[0].landmarks,
    d=>d.frames.find(f=>f.landmarks).landmarks.pop(),
    d=>d.frames.find(f=>f.landmarks).landmarks[0].x=Infinity,
    d=>d.frames.find(f=>f.landmarks).landmarks[0].visibility=2];
  for (const mutate of mutations) {
    const data = structuredClone(real); mutate(data);
    assert.throws(() => validateReference(data));
  }
});
