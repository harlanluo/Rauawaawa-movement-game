// Pure data helpers; no inference or browser dependencies.
export const SOURCE_VIDEO = 'assets/videos/e9d87196a2d98e530ab1ddebd7c56c5e.mp4';
export const REFERENCE_JSON = 'assets/games/demo-standing/reference-pose.json';

export function validateReference(data) {
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  require(data?.formatVersion === 1, 'Expected reference formatVersion 1.');
  require(data.sourceVideo === SOURCE_VIDEO, 'Reference sourceVideo does not match the configured video.');
  for (const key of ['width', 'height', 'durationMs', 'sourceFps']) {
    require(Number.isFinite(data.video?.[key]) && data.video[key] > 0, `Invalid video ${key}.`);
  }
  require(Number.isFinite(data.sampling?.targetFps) && data.sampling.targetFps > 0 &&
    data.sampling.targetFps <= data.video.sourceFps, 'Invalid sampling targetFps.');
  require(Array.isArray(data.frames) && data.frames.length > 0, 'Reference frames must be a nonempty array.');
  let previous = -1;
  for (const [index, frame] of data.frames.entries()) {
    require(Number.isInteger(frame?.timeMs) && frame.timeMs > previous &&
      frame.timeMs < data.video.durationMs, `Invalid or unordered timestamp at sample ${index}.`);
    previous = frame.timeMs;
    if (frame.landmarks === null) continue;
    require(Array.isArray(frame.landmarks) && frame.landmarks.length === 33,
      `Sample ${index} must have 33 landmarks or explicit null.`);
    for (const point of frame.landmarks) {
      require(point && ['x', 'y', 'z'].every(axis => Number.isFinite(point[axis])),
        `Invalid coordinates at sample ${index}.`);
      require(point.visibility === null || (Number.isFinite(point.visibility) &&
        point.visibility >= 0 && point.visibility <= 1), `Invalid visibility at sample ${index}.`);
    }
  }
  return data;
}

// Half the requested interval plus one decoded frame and 1 ms rounding allowance.
export function matchingTolerance(data) {
  return 500 / data.sampling.targetFps + 1000 / data.video.sourceFps + 1;
}

export function nearestSample(frames, timeMs, toleranceMs) {
  if (!frames.length || !Number.isFinite(timeMs) || !Number.isFinite(toleranceMs) || toleranceMs < 0) return null;
  let low = 0, high = frames.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (frames[middle].timeMs < timeMs) low = middle + 1;
    else high = middle;
  }
  let index = Math.min(low, frames.length - 1);
  // Ties consistently choose the earlier sample.
  if (index > 0 && Math.abs(frames[index - 1].timeMs - timeMs) <= Math.abs(frames[index].timeMs - timeMs)) index--;
  const deltaMs = frames[index].timeMs - timeMs;
  return Math.abs(deltaMs) <= toleranceMs ? { index, frame: frames[index], deltaMs } : null;
}

export function missingRanges(frames) {
  const ranges = [];
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].landmarks !== null) continue;
    const startIndex = i;
    while (i + 1 < frames.length && frames[i + 1].landmarks === null) i++;
    ranges.push({ startIndex, endIndex: i, startMs: frames[startIndex].timeMs,
      endMs: frames[i].timeMs, count: i - startIndex + 1 });
  }
  return ranges;
}

// Standard MediaPipe Pose connections, stored locally (no MediaPipe import).
export const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
  [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
  [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
  [11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28],
  [27,29],[28,30],[29,31],[30,32],[27,31],[28,32]
];
