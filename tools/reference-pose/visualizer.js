import { SOURCE_VIDEO, REFERENCE_JSON, validateReference, matchingTolerance,
  nearestSample, missingRanges, CONNECTIONS } from './visualizer-data.mjs';

const $ = id => document.getElementById(id);
const video = $('video'), canvas = $('overlay'), context = canvas.getContext('2d');
const root = new URL('../../', import.meta.url);
let data, tolerance, failed = false, ready = false;
const seconds = value => `${(value / 1000).toFixed(3)} s`;

function table(id, entries) {
  $(id).replaceChildren(...entries.flatMap(([key, value]) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = key; dd.textContent = value;
    return [dt, dd];
  }));
}

function fail(error) {
  failed = true; ready = false;
  video.pause(); $('controls').disabled = true;
  context?.clearRect(0, 0, canvas.width, canvas.height);
  $('status').className = 'error';
  $('status').textContent = `Cannot display reference: ${error.message}`;
  console.error('Reference visualizer failed:', error);
}

function render() {
  if (!ready || failed) return;
  const timeMs = video.currentTime * 1000;
  const match = nearestSample(data.frames, timeMs, tolerance);
  // Canvas uses intrinsic video pixels; CSS scales video and canvas together.
  context.clearRect(0, 0, canvas.width, canvas.height);
  const pose = !video.seeking && match?.frame.landmarks;
  if (pose) {
    context.strokeStyle = '#00ffff'; context.lineWidth = 3;
    if ($('skeleton').checked) {
      context.beginPath();
      for (const [a, b] of CONNECTIONS) {
        context.moveTo(pose[a].x * canvas.width, pose[a].y * canvas.height);
        context.lineTo(pose[b].x * canvas.width, pose[b].y * canvas.height);
      }
      context.stroke();
    }
    if ($('points').checked) {
      context.fillStyle = '#ffe342';
      for (const point of pose) {
        context.beginPath(); context.arc(point.x * canvas.width, point.y * canvas.height, 4, 0, Math.PI * 2); context.fill();
      }
    }
  }
  const state = video.seeking ? 'Seeking video…' : !match ? 'No matching reference sample available' :
    data.coverage?.inactiveRanges.some(r => r.startMs <= timeMs && timeMs < r.endMs) ?
      'Inactive: sustained near-black section' : match.frame.landmarks === null ? 'Pose missing at this sample' : 'Pose detected';
  $('status').textContent = state;
  $('status').className = !match || match.frame.landmarks === null ? 'missing' : '';
  table('current', [['Video time', seconds(timeMs)], ['Reference time', match ? seconds(match.frame.timeMs) : '—'],
    ['Sample index', match ? `${match.index} (0-based)` : '—'],
    ['Delta (reference − video)', match ? `${match.deltaMs.toFixed(1)} ms` : '—'],
    ['Detection', video.seeking ? 'Seeking' : !match ? 'No match' : pose ? 'Detected' : 'Missing'],
    ['Landmark count', pose ? pose.length : 0]]);
  $('previous').disabled = timeMs <= data.frames[0].timeMs;
  $('next').disabled = timeMs >= data.frames.at(-1).timeMs;
}

function seekSample(index) {
  if (!ready || failed || !Number.isInteger(index) || index < 0 || index >= data.frames.length) return;
  video.pause(); video.currentTime = data.frames[index].timeMs / 1000;
  $('sample-input').value = index;
  render(); // seeking clears the old pose; seeked draws against the new video frame.
}

function step(direction) {
  const match = nearestSample(data.frames, video.currentTime * 1000, Number.MAX_VALUE);
  seekSample(Math.max(0, Math.min(data.frames.length - 1, match.index + direction)));
}

$('previous').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));
$('jump').addEventListener('submit', event => { event.preventDefault(); seekSample(Number($('sample-input').value)); });
$('next-missing').addEventListener('click', () => {
  const index = data.frames.findIndex(frame => frame.landmarks === null && frame.timeMs > video.currentTime * 1000 + 1);
  seekSample(index >= 0 ? index : data.frames.findIndex(frame => frame.landmarks === null));
});
for (const id of ['skeleton', 'points']) $(id).addEventListener('change', render);
for (const event of ['timeupdate', 'seeking', 'seeked', 'pause', 'ended', 'loadeddata']) video.addEventListener(event, render);
video.addEventListener('error', () => fail(video.error || new Error('Video failed to load.')));

function playbackFrame() {
  if (failed) return;
  render();
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(playbackFrame);
  else requestAnimationFrame(playbackFrame);
}

async function start() {
  if (!context) throw new Error('Canvas is unavailable in this browser.');
  const response = await fetch(new URL(REFERENCE_JSON, root));
  if (!response.ok) throw new Error(`Reference JSON request returned HTTP ${response.status}.`);
  data = validateReference(await response.json());
  tolerance = matchingTolerance(data);
  const ranges = missingRanges(data.frames);
  const missing = ranges.reduce((sum, range) => sum + range.count, 0);
  const detected = data.frames.length - missing;
  table('summary', [['Total samples', data.frames.length], ['Detected', detected], ['Missing', missing],
    ['Detected percentage', `${(100 * detected / data.frames.length).toFixed(2)}%`],
    ['Target rate', `${data.sampling.targetFps} FPS`], ['Match tolerance', `±${tolerance.toFixed(1)} ms`],
    ['Source', data.sourceVideo], ['Reference', REFERENCE_JSON],
    ['Subject tracking', data.subjectTracking?.strategy || 'Not specified'],
    ['Usable coverage (not pose validity)', data.usableRanges ? data.usableRanges.map(r =>
      `${seconds(r.startMs)}–${seconds(r.endMs)} (end exclusive)`).join('; ') || 'None' : 'Not specified']]);
  $('sample-input').max = data.frames.length - 1;
  $('next-missing').disabled = missing === 0;
  const longest = ranges.reduce((best, range) => !best || range.endMs - range.startMs > best.endMs - best.startMs ? range : best, null);
  $('range-summary').textContent = longest ? `${ranges.length} ranges. Longest sampled span: ${seconds(longest.startMs)}–${seconds(longest.endMs)} (${seconds(longest.endMs - longest.startMs)}, ${longest.count} samples).` : 'No missing samples.';
  for (const range of ranges) {
    const li = document.createElement('li'), button = document.createElement('button');
    button.textContent = `${seconds(range.startMs)}–${seconds(range.endMs)} · ${range.count} samples`;
    button.addEventListener('click', () => seekSample(range.startIndex));
    li.append(button); $('ranges').append(li);
  }
  video.addEventListener('loadedmetadata', () => {
    if (failed) return;
    if (video.videoWidth !== data.video.width || video.videoHeight !== data.video.height ||
      !Number.isFinite(video.duration) || Math.abs(video.duration * 1000 - data.video.durationMs) > 1000 / data.video.sourceFps + 2) {
      fail(new Error('Video dimensions/duration do not match reference metadata.')); return;
    }
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    ready = true; $('controls').disabled = false; render(); playbackFrame();
  }, { once: true });
  // SimpleHTTPRequestHandler need not support byte ranges. A local blob makes
  // sample seeking reliable without adding a custom server or copying an asset.
  $('status').textContent = 'Loading video for precise sample seeking…';
  const videoResponse = await fetch(new URL(SOURCE_VIDEO, root));
  if (!videoResponse.ok) throw new Error(`Video request returned HTTP ${videoResponse.status}.`);
  const videoUrl = URL.createObjectURL(await videoResponse.blob());
  window.addEventListener('pagehide', () => URL.revokeObjectURL(videoUrl), { once: true });
  video.src = videoUrl;
}
start().catch(fail);
