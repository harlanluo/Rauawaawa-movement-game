import { comparePoses } from '../../js/pose-comparison.js';
import { createPoseTracker } from '../../js/pose-tracker.js';
import { SOURCE_VIDEO, REFERENCE_JSON, validateReference, matchingTolerance,
  nearestSample, CONNECTIONS } from '../reference-pose/visualizer-data.mjs';
import { createPlayerPose, formatResult } from './visualizer-data.mjs';

const $ = id => document.getElementById(id);
const root = new URL('../../', import.meta.url);
const video = $('video');
const referenceCanvas = $('reference-canvas');
const playerCanvas = $('player-canvas');
const referenceContext = referenceCanvas.getContext('2d');
const playerContext = playerCanvas.getContext('2d');
const scoreStrip = document.querySelector('.score-strip');
let data;
let tolerance;
let ready = false;
let failed = false;
let poseTracker = null;
let cameraEnabled = false;
let livePose = null;

function controls() {
  return {
    translatePercent: Number($('translate').value),
    scalePercent: Number($('scale').value),
    leftArmDegrees: Number($('left-arm').value),
    rightArmDegrees: Number($('right-arm').value),
    legDegrees: Number($('legs').value),
    hideLowerBody: $('hide-lower').checked
  };
}

function currentMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function currentSource() {
  return document.querySelector('input[name="source"]:checked').value;
}

function drawGrid(context, canvas) {
  context.fillStyle = '#05090b';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#18272f';
  context.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += canvas.width / 8) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke();
  }
  for (let y = 0; y <= canvas.height; y += canvas.height / 4) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke();
  }
}

function drawPose(context, canvas, pose, lineColor, pointColor) {
  if (!pose) return;
  context.strokeStyle = lineColor;
  context.lineWidth = 3;
  context.beginPath();
  for (const [a, b] of CONNECTIONS) {
    if ((pose[a].visibility ?? 1) < 0.5 || (pose[b].visibility ?? 1) < 0.5) continue;
    context.moveTo(pose[a].x * canvas.width, pose[a].y * canvas.height);
    context.lineTo(pose[b].x * canvas.width, pose[b].y * canvas.height);
  }
  context.stroke();
  context.fillStyle = pointColor;
  for (const point of pose) {
    if ((point.visibility ?? 1) < 0.5) continue;
    context.beginPath();
    context.arc(point.x * canvas.width, point.y * canvas.height, 4, 0, Math.PI * 2);
    context.fill();
  }
}

function renderFeatures(result) {
  const features = $('features');
  features.replaceChildren();
  const feedback = result?.feedback || [];
  $('feature-count').textContent = `${feedback.length} compared`;
  if (!feedback.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = result?.rating === 'insufficient' ? 'Not enough visible landmarks to compare.' : 'No comparable sample at this time.';
    features.append(empty);
    return;
  }
  for (const item of feedback) {
    const row = document.createElement('div');
    row.className = 'feature';
    row.dataset.rating = item.rating;
    const name = document.createElement('span');
    name.className = 'feature-name';
    name.textContent = item.label;
    const meter = document.createElement('span');
    meter.className = 'meter';
    const fill = document.createElement('span');
    fill.style.setProperty('--score', `${Math.round(item.score * 100)}%`);
    meter.append(fill);
    const score = document.createElement('span');
    score.className = 'feature-score';
    score.textContent = `${Math.round(item.score * 100)}%`;
    row.append(name, meter, score);
    features.append(row);
  }
}

function render() {
  if (!ready || failed) return;
  const match = nearestSample(data.frames, video.currentTime * 1000, tolerance);
  const reference = !video.seeking ? match?.frame.landmarks : null;
  referenceContext.clearRect(0, 0, referenceCanvas.width, referenceCanvas.height);
  const live = currentSource() === 'camera';
  const cameraDrawn = live && poseTracker?.drawDebugFrame(playerCanvas);
  if (!cameraDrawn) drawGrid(playerContext, playerCanvas);
  if (!reference) {
    $('status').textContent = video.seeking ? 'Seeking video…' : 'No reference pose at this sample';
    $('status').className = 'missing';
    for (const id of ['similarity', 'rating', 'weight']) $(id).textContent = '—';
    $('time').textContent = match ? `${(match.frame.timeMs / 1000).toFixed(2)} s` : '—';
    scoreStrip.dataset.rating = 'skipped';
    renderFeatures(null);
    return;
  }

  if (live && !cameraEnabled) {
    $('status').textContent = 'Start the camera to compare a live player pose';
    $('status').className = 'missing';
    for (const id of ['similarity', 'rating', 'weight']) $(id).textContent = '—';
    $('time').textContent = `${(match.frame.timeMs / 1000).toFixed(2)} s`;
    scoreStrip.dataset.rating = 'skipped';
    renderFeatures(null);
    return;
  }

  const player = live ? livePose : createPlayerPose(reference, controls());
  const result = comparePoses(reference, player, { bodyMode: currentMode() });
  drawPose(referenceContext, referenceCanvas, reference, '#61ddd7', '#ffd65a');
  if (!live) drawPose(playerContext, playerCanvas, player, '#a9e8c0', '#ffcf70');
  const formatted = formatResult(result);
  $('similarity').textContent = formatted.similarity;
  $('rating').textContent = formatted.rating;
  $('weight').textContent = formatted.weight;
  $('time').textContent = `${(match.frame.timeMs / 1000).toFixed(2)} s`;
  scoreStrip.dataset.rating = result.rating;
  $('status').textContent = live && !cameraEnabled ? 'Start the camera to compare a live player pose' :
    result.rating === 'insufficient'
      ? `${currentMode() === 'seated' ? 'Upper-body' : 'Full-body'} input is insufficient`
      : `${currentMode() === 'seated' ? 'Upper-body' : 'Full-body'} comparison active`;
  $('status').className = result.rating === 'insufficient' ? 'missing' : '';
  renderFeatures(result);
}

function updateOutputs() {
  $('translate-output').textContent = `${$('translate').value}%`;
  $('scale-output').textContent = `${$('scale').value}%`;
  $('left-arm-output').textContent = `${$('left-arm').value}°`;
  $('right-arm-output').textContent = `${$('right-arm').value}°`;
  $('legs-output').textContent = `${$('legs').value}°`;
}

function setControls(values = {}) {
  const defaults = { translate: 0, scale: 100, 'left-arm': 0, 'right-arm': 0, legs: 0, 'hide-lower': false };
  for (const [id, value] of Object.entries({ ...defaults, ...values })) {
    const element = $(id);
    if (element.type === 'checkbox') element.checked = value;
    else element.value = value;
  }
  updateOutputs();
  render();
}

function updateCameraStatus({ state, message }) {
  $('camera-status').textContent = message;
  if (['stopped', 'unavailable'].includes(state)) {
    cameraEnabled = false;
    livePose = null;
  }
  $('camera-toggle').textContent = cameraEnabled ? 'Stop camera' : 'Start camera';
  $('camera-toggle').setAttribute('aria-pressed', String(cameraEnabled));
  render();
}

function ensurePoseTracker() {
  if (poseTracker) return poseTracker;
  poseTracker = createPoseTracker({
    forceCPU: new URLSearchParams(location.search).get('poseDelegate') === 'cpu',
    onStatus: updateCameraStatus,
    onPose: () => {
      livePose = poseTracker.getLatestLandmarks();
      render();
    }
  });
  return poseTracker;
}

function stopCamera() {
  cameraEnabled = false;
  livePose = null;
  poseTracker?.stop();
  updateCameraStatus({ state: 'stopped', message: 'Camera off' });
}

async function toggleCamera() {
  if (cameraEnabled) {
    stopCamera();
    return;
  }
  cameraEnabled = true;
  updateCameraStatus({ state: 'starting', message: 'Starting camera…' });
  await ensurePoseTracker().start();
}

function updateSource() {
  const live = currentSource() === 'camera';
  $('simulation-controls').hidden = live;
  $('camera-controls').hidden = !live;
  $('player-source-label').textContent = live ? 'Live camera landmarks' : 'Simulated landmarks';
  document.querySelector('.player-stage').dataset.source = live ? 'camera' : 'simulation';
  if (!live) stopCamera();
  render();
}

const presets = {
  perfect: {},
  framing: { translate: 18, scale: 72 },
  arms: { 'left-arm': 85, 'right-arm': -70 },
  cropped: { 'hide-lower': true }
};

for (const id of ['translate', 'scale', 'left-arm', 'right-arm', 'legs']) {
  $(id).addEventListener('input', () => { updateOutputs(); render(); });
}
$('hide-lower').addEventListener('change', render);
for (const radio of document.querySelectorAll('input[name="mode"]')) radio.addEventListener('change', render);
for (const radio of document.querySelectorAll('input[name="source"]')) radio.addEventListener('change', updateSource);
$('camera-toggle').addEventListener('click', () => void toggleCamera());
for (const button of document.querySelectorAll('[data-preset]')) {
  button.addEventListener('click', () => setControls(presets[button.dataset.preset]));
}
$('reset').addEventListener('click', () => setControls());
for (const event of ['timeupdate', 'seeking', 'seeked', 'pause', 'ended', 'loadeddata']) video.addEventListener(event, render);

function fail(error) {
  failed = true;
  video.pause();
  $('controls').disabled = true;
  $('status').textContent = `Cannot display comparison: ${error.message}`;
  $('status').className = 'error';
  console.error('Pose comparison visualizer failed:', error);
}

function playbackFrame() {
  if (failed) return;
  render();
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(playbackFrame);
  else requestAnimationFrame(playbackFrame);
}

async function start() {
  if (!referenceContext || !playerContext) throw new Error('Canvas is unavailable in this browser.');
  const response = await fetch(new URL(REFERENCE_JSON, root));
  if (!response.ok) throw new Error(`Reference JSON request returned HTTP ${response.status}.`);
  data = validateReference(await response.json());
  tolerance = matchingTolerance(data);
  video.addEventListener('loadedmetadata', () => {
    if (failed) return;
    referenceCanvas.width = playerCanvas.width = video.videoWidth;
    referenceCanvas.height = playerCanvas.height = video.videoHeight;
    ready = true;
    $('controls').disabled = false;
    updateOutputs();
    render();
    playbackFrame();
  }, { once: true });
  video.addEventListener('error', () => fail(video.error || new Error('Video failed to load.')));
  $('status').textContent = 'Loading video for precise timeline matching…';
  const videoResponse = await fetch(new URL(SOURCE_VIDEO, root));
  if (!videoResponse.ok) throw new Error(`Video request returned HTTP ${videoResponse.status}.`);
  const videoUrl = URL.createObjectURL(await videoResponse.blob());
  window.addEventListener('pagehide', () => URL.revokeObjectURL(videoUrl), { once: true });
  window.addEventListener('pagehide', () => poseTracker?.destroy(), { once: true });
  video.src = videoUrl;
}

start().catch(fail);
