// Run: node --experimental-vm-modules --test --test-isolation=none tests/pose-tracker.test.cjs
// Controlled lifecycle tests; these do not claim real camera/model performance.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/pose-tracker.js'), 'utf8');
const deferred = () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
};

async function harness({ raf = false, gpuFails = false, cpuFails = false, permission, forceCPU = false, modelGate, importFails = false, wasmFails = false, playFails = false, unavailable = false } = {}) {
    const operations = [];
    const warnings = [];
    const callbacks = new Map();
    const streams = [];
    const delegates = [];
    const statuses = [];
    const listeners = {};
    let landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
    let id = 0, now = 0, detections = 0, closed = 0, requests = 0;
    let detectionError = false;
    const video = {
        readyState: 2, currentTime: 0, videoWidth: 640, videoHeight: 480,
        setAttribute() {}, pause() {}, play: async () => {
            operations.push('play');
            assert.ok(video.srcObject);
            if (playFails) throw Error('play failed');
        }, srcObject: null
    };
    const request = cb => { callbacks.set(++id, cb); return id; };
    const cancel = key => callbacks.delete(key);
    if (!raf) { video.requestVideoFrameCallback = request; video.cancelVideoFrameCallback = cancel; }
    function newStream() {
        const track = { readyState: 'live', stop() { this.readyState = 'ended'; },
            addEventListener(event, cb) { this.ended = cb; } };
        const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
        streams.push(stream);
        return stream;
    }
    const context = vm.createContext({
        document: { createElement: () => video },
        navigator: { mediaDevices: unavailable ? undefined : { getUserMedia: async constraints => {
            requests++;
            operations.push('camera');
            assert.equal(constraints.audio, false);
            assert.equal(constraints.video.width.ideal, 640);
            if (permission) return permission(newStream);
            return newStream();
        } } },
        requestAnimationFrame: request, cancelAnimationFrame: cancel,
        location: { protocol: 'http:' }, isSecureContext: !unavailable,
        performance: { now: () => now }, console: { warn: (...args) => warnings.push(args) }
    });
    const library = new vm.SyntheticModule(['FilesetResolver', 'PoseLandmarker'], function() {
        this.setExport('FilesetResolver', { forVisionTasks: async () => {
            operations.push('wasm');
            if (wasmFails) throw Error('wasm failed');
            return {};
        } });
        this.setExport('PoseLandmarker', { createFromOptions: async (files, options) => {
            const delegate = options.baseOptions.delegate;
            delegates.push(delegate);
            operations.push(delegate);
            if (modelGate) await modelGate;
            assert.equal(options.numPoses, 1);
            assert.equal(options.runningMode, 'VIDEO');
            assert.equal(options.outputSegmentationMasks, false);
            assert.match(options.baseOptions.modelAssetPath, /pose_landmarker_lite\/float16\/1\//);
            if ((delegate === 'GPU' && gpuFails) || (delegate === 'CPU' && cpuFails)) throw Error('delegate failure');
            return { detectForVideo(input) {
                assert.equal(input, video);
                detections++;
                if (detectionError) throw Error('detection failed');
                now += 5;
                return { landmarks: landmarks ? [landmarks] : [] };
            }, close() { closed++; } };
        } });
    }, { context });
    await library.link(() => {});
    await library.evaluate();
    const module = new vm.SourceTextModule(source, { context, importModuleDynamically: () => {
        operations.push('import');
        if (importFails) throw Error('import failed');
        return library;
    } });
    await module.link(() => {});
    await module.evaluate();
    const tracker = module.namespace.createPoseTracker({ forceCPU,
        onStatus: status => { statuses.push(status); listeners.onStatus?.(status); },
        onPose: timestamp => listeners.onPose?.(timestamp)
    });
    return { tracker, video, callbacks, streams, delegates, statuses, listeners, operations, warnings,
        setLandmarks: value => { landmarks = value; },
        stats: () => ({ detections, closed, requests }),
        detectionError: () => { detectionError = true; },
        tick(time, advance = true) {
            now = time;
            if (advance) video.currentTime += 1 / 60;
            const pending = [...callbacks.values()];
            callbacks.clear();
            pending.forEach(cb => cb(time));
        }
    };
}

for (const raf of [false, true]) test(`lifecycle, cap, reuse and cleanup (${raf ? 'RAF' : 'video callback'})`, async () => {
    const h = await harness({ raf });
    assert.equal(h.delegates.length, 0);
    await h.tracker.start();
    assert.equal(h.video.hidden, true);
    for (let t = 0; t < 1000; t += 1000 / 60) h.tick(t);
    assert.ok(h.stats().detections >= 10 && h.stats().detections <= 15);
    assert.equal(h.tracker.getLatestLandmarks().length, 33);
    assert.equal(h.tracker.getDiagnostics().cameraWidth, 640);
    const count = h.stats().detections;
    h.tracker.pauseProcessing();
    h.tick(1100);
    assert.equal(h.stats().detections, count);
    assert.equal(h.callbacks.size, 0);
    assert.equal(h.tracker.getLatestLandmarks(), null);
    h.tracker.resumeProcessing(); h.tracker.resumeProcessing();
    assert.equal(h.callbacks.size, 1);
    h.tick(1200);
    assert.equal(h.stats().detections, count + 1);
    h.tracker.stop();
    assert.equal(h.streams[0].getTracks()[0].readyState, 'ended');
    assert.equal(h.video.srcObject, null);
    assert.equal(h.callbacks.size, 0);
    assert.equal(h.tracker.getLatestLandmarks(), null);
    await h.tracker.start();
    assert.equal(h.delegates.length, 1);
    assert.equal(h.callbacks.size, 1);
    assert.equal(h.streams.filter(s => s.getTracks()[0].readyState === 'live').length, 1);
    h.tracker.destroy();
    assert.equal(h.stats().closed, 1);
    assert.equal(h.callbacks.size, 0);
});

test('camera permission and attached video precede all MediaPipe work', async () => {
    const h = await harness();
    await h.tracker.start();
    assert.deepEqual(h.operations, ['camera', 'play', 'import', 'wasm', 'GPU']);
    assert.equal(h.callbacks.size, 1);
    h.tracker.destroy();
});

test('denial skips MediaPipe; initialization failures release acquired tracks and are tracking errors', async () => {
    const denied = await harness({ permission: () => { throw Object.assign(Error('denied'), { name: 'NotAllowedError' }); } });
    await denied.tracker.start();
    assert.deepEqual(denied.operations, ['camera']);
    assert.equal(denied.tracker.getDiagnostics().errorCategory, 'camera');
    for (const config of [{ importFails: true }, { wasmFails: true }, { gpuFails: true, cpuFails: true }]) {
        const h = await harness(config);
        await h.tracker.start();
        assert.equal(h.operations[0], 'camera');
        assert.equal(h.streams[0].getTracks()[0].readyState, 'ended');
        assert.equal(h.video.srcObject, null);
        assert.equal(h.callbacks.size, 0);
        assert.equal(h.tracker.getDiagnostics().errorCategory, 'tracking');
        assert.equal(h.statuses.at(-1).message, 'Movement tracking unavailable');
    }
    const fallback = await harness({ gpuFails: true });
    await fallback.tracker.start();
    assert.deepEqual(fallback.operations, ['camera', 'play', 'import', 'wasm', 'GPU', 'CPU']);
    assert.equal(fallback.tracker.getDiagnostics().delegate, 'CPU');
    fallback.tracker.destroy();
});

test('cancellation during model loading releases camera and resume cannot infer early', async () => {
    const pending = deferred();
    const h = await harness({ modelGate: pending.promise });
    const started = h.tracker.start();
    while (!h.delegates.length) await new Promise(r => setImmediate(r));
    assert.equal(h.tracker.getDiagnostics().state, 'loading');
    h.tracker.pauseProcessing(); h.tracker.resumeProcessing(); h.tick(1000);
    assert.equal(h.stats().detections, 0);
    assert.equal(h.callbacks.size, 0);
    h.tracker.stop();
    assert.equal(h.streams[0].getTracks()[0].readyState, 'ended');
    pending.resolve(); await started;
    assert.equal(h.video.srcObject, null);
    assert.equal(h.callbacks.size, 0);
    assert.equal(h.tracker.getDiagnostics().state, 'stopped');
    h.tracker.destroy();
});

test('cancelled pending permission never initializes MediaPipe', async () => {
    const gate = deferred();
    const h = await harness({ permission: async create => { await gate.promise; return create(); } });
    const started = h.tracker.start();
    while (!h.stats().requests) await new Promise(r => setImmediate(r));
    h.tracker.stop(); gate.resolve(); await started;
    assert.deepEqual(h.operations, ['camera']);
    assert.equal(h.streams[0].getTracks()[0].readyState, 'ended');
    assert.equal(h.video.srcObject, null);
    assert.equal(h.callbacks.size, 0);
});

test('camera capability and video playback failures retain stage details', async () => {
    const missing = await harness({ unavailable: true });
    await missing.tracker.start();
    assert.equal(missing.warnings[0][1].protocol, 'http:');
    assert.equal(missing.warnings[0][1].isSecureContext, false);
    assert.equal(missing.tracker.getDiagnostics().errorCategory, 'camera');
    const playback = await harness({ playFails: true });
    await playback.tracker.start();
    assert.deepEqual(playback.operations, ['camera', 'play']);
    assert.match(playback.warnings[0][0], /video.play/);
    assert.equal(playback.warnings[0][1].message, 'play failed');
    assert.equal(playback.streams[0].getTracks()[0].readyState, 'ended');
    assert.equal(playback.video.srcObject, null);
});

test('GPU fallback, forced CPU and total initialization failure', async () => {
    for (const config of [{ gpuFails: true }, { forceCPU: true }, { gpuFails: true, cpuFails: true }]) {
        const h = await harness(config);
        await h.tracker.start();
        assert.equal(h.delegates.at(-1), 'CPU');
        if (config.forceCPU) assert.equal(h.delegates.length, 1);
        assert.equal(h.tracker.getDiagnostics().state, config.cpuFails ? 'unavailable' : 'looking');
        h.tracker.destroy();
    }
});

test('permission denied is handled without rejection', async () => {
    const h = await harness({ permission: () => { throw Object.assign(Error('denied'), { name: 'NotAllowedError' }); } });
    await h.tracker.start();
    assert.equal(h.tracker.getDiagnostics().state, 'unavailable');
    assert.equal(h.statuses.at(-1).message, 'Camera access is off');
    assert.equal(h.callbacks.size, 0);
});

test('leaving during permission then retrying closes stale stream and serializes requests', async () => {
    const pending = deferred();
    let first = true;
    const h = await harness({ permission: async create => {
        if (first) { first = false; await pending.promise; }
        return create();
    } });
    const old = h.tracker.start();
    while (!h.stats().requests) await new Promise(r => setImmediate(r));
    h.tracker.stop();
    const retry = h.tracker.start();
    assert.equal(h.stats().requests, 1);
    pending.resolve();
    await Promise.all([old, retry]);
    assert.equal(h.streams[0].getTracks()[0].readyState, 'ended');
    assert.equal(h.streams[1].getTracks()[0].readyState, 'live');
    assert.equal(h.callbacks.size, 1);
    h.tracker.destroy();
});

test('pause while starting prevents processing, detection and stream errors release tracks', async () => {
    const h = await harness();
    const started = h.tracker.start();
    h.tracker.pauseProcessing();
    await started;
    assert.equal(h.callbacks.size, 0);
    assert.equal(h.tracker.getDiagnostics().state, 'paused');
    h.tracker.resumeProcessing();
    h.detectionError(); h.tick(1000);
    assert.equal(h.tracker.getDiagnostics().state, 'unavailable');
    assert.equal(h.streams[0].getTracks()[0].readyState, 'ended');
    assert.equal(h.callbacks.size, 0);
    await h.tracker.start();
    h.streams[1].getTracks()[0].ended();
    assert.equal(h.tracker.getDiagnostics().state, 'unavailable');
    assert.equal(h.streams[1].getTracks()[0].readyState, 'ended');
    assert.equal(h.callbacks.size, 0);
});

test('real app handlers release mock camera on Finish, Quit, navigation and pagehide', async () => {
    const h = await harness();
    const elements = new Map();
    const events = new Map();
    let scoreUpdates = 0;
    function element(id) {
        if (!elements.has(id)) elements.set(id, {
            textContent: '', dataset: {}, style: {}, value: '', currentTime: 0, duration: 73,
            classList: { add() {}, remove() {} }, addEventListener() {},
            getAttribute: () => '', setAttribute() {}, load() {}, pause() {}, play: async () => {}
        });
        return elements.get(id);
    }
    const context = vm.createContext({
        document: { getElementById: element, querySelectorAll: () => [] },
        window: { addEventListener: (type, callback) => events.set(type, callback) },
        location: { search: '' }, URLSearchParams, console, setInterval, clearInterval,
        setTimeout, clearTimeout,
        fetch: async () => ({ ok: true, json: async () => ({ frames: [{ timeMs: 0, landmarks: poseFixture('neutral') }] }) })
    });
    const module = new vm.SyntheticModule(['createPoseTracker'], function() {
        this.setExport('createPoseTracker', options => { Object.assign(h.listeners, options); return h.tracker; });
    }, { context });
    await module.link(() => {}); await module.evaluate();
    const scoringModule = new vm.SyntheticModule(['createPoseScoringSession'], function() {
        this.setExport('createPoseScoringSession', () => ({
            update() {
                scoreUpdates++;
                return { score: 88, result: { rating: 'good', feedback: [] } };
            }
        }));
    }, { context });
    await scoringModule.link(() => {}); await scoringModule.evaluate();
    const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/avatar-pose-controller.js'), 'utf8'), context);
    new vm.Script(app, {
        importModuleDynamically: specifier => specifier === './pose-scoring.js' ? scoringModule : module
    }).runInContext(context);
    vm.runInContext('triggerConfetti = () => {};', context);
    async function start(action = 'startGame(1)') {
        const requestsBefore = h.stats().requests;
        vm.runInContext(action, context);
        await new Promise(r => setImmediate(r));
        assert.equal(h.stats().requests, requestsBefore, 'entering game must not request camera');
        assert.equal(vm.runInContext('cameraEnabled', context), false);
        assert.equal(element('cameraToggle').textContent, 'Camera: OFF');
        assert.equal(element('avatarSvg').dataset.pose, 'neutral');
        vm.runInContext('togglePlayerCamera()', context);
        for (let i = 0; i < 20 && h.callbacks.size === 0; i++) await new Promise(r => setImmediate(r));
        assert.equal(h.callbacks.size, 1);
        assert.equal(h.streams.filter(s => s.getTracks()[0].readyState === 'live').length, 1);
    }
    function released() {
        assert.ok(h.streams.every(s => s.getTracks()[0].readyState === 'ended'));
        assert.equal(h.callbacks.size, 0);
        assert.equal(h.video.srcObject, null);
        assert.equal(element('trackingStatus').textContent, 'Camera off');
        assert.equal(element('avatarSvg').dataset.pose, 'neutral');
    }
    // Cancel during the lazy import, before any camera/model work can begin.
    vm.runInContext('startGame(1); togglePlayerCamera(); togglePlayerCamera();', context);
    await new Promise(r => setImmediate(r));
    assert.equal(h.stats().requests, 0);
    assert.equal(h.delegates.length, 0);
    released();
    await start();
    h.setLandmarks(poseFixture('leftHandUp'));
    h.tick(1000); h.tick(1250);
    assert.equal(element('avatarSvg').dataset.pose, 'leftHandUp');
    assert.ok(scoreUpdates > 0);
    assert.equal(element('gameScoreDisplay').textContent, 88);
    assert.equal(element('movementFeedback').dataset.rating, 'good');
    h.setLandmarks(null); h.tick(1500);
    assert.equal(element('avatarSvg').dataset.pose, 'neutral');
    assert.equal(element('trackingStatus').textContent, 'Looking for you…');
    vm.runInContext('togglePauseGame()', context); assert.equal(h.callbacks.size, 0);
    vm.runInContext('togglePauseGame()', context); assert.equal(h.callbacks.size, 1);
    vm.runInContext('togglePlayerCamera()', context); released();
    vm.runInContext('togglePauseGame(); togglePauseGame()', context);
    assert.equal(h.callbacks.size, 0, 'resume must not turn an OFF camera on');
    for (let i = 0; i < 3; i++) {
        vm.runInContext('togglePlayerCamera()', context);
        for (let j = 0; j < 20 && !h.callbacks.size; j++) await new Promise(r => setImmediate(r));
        assert.equal(h.callbacks.size, 1);
        assert.equal(h.streams.filter(s => s.getTracks()[0].readyState === 'live').length, 1);
        vm.runInContext('togglePlayerCamera()', context); released();
    }
    vm.runInContext('togglePlayerCamera()', context);
    for (let j = 0; j < 20 && !h.callbacks.size; j++) await new Promise(r => setImmediate(r));
    vm.runInContext('finishGame()', context); released();
    await start('restartGame()');
    vm.runInContext('finishGame()', context); released();
    await start('continueNextGame()');
    assert.equal(vm.runInContext('currentGameNumber', context), 2);
    vm.runInContext('quitGame()', context); released();
    await start(); vm.runInContext("goToScreen('screen-home')", context); released();
    await start(); events.get('pagehide')(); released();
    assert.equal(h.delegates.length, 1);
});

function poseFixture(state) {
    const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.8, visibility: 1 }));
    points[11] = { x: 0.65, y: 0.4, visibility: 1 };
    points[12] = { x: 0.35, y: 0.4, visibility: 1 };
    points[15] = { x: 0.7, y: 0.75, visibility: 1 };
    points[16] = { x: 0.3, y: 0.75, visibility: 1 };
    if (['leftHandUp', 'bothHandsUp'].includes(state)) points[15].y = 0.1;
    if (['rightHandUp', 'bothHandsUp'].includes(state)) points[16].y = 0.1;
    if (state === 'armsOpen') {
        points[15] = { x: 0.95, y: 0.4, visibility: 1 };
        points[16] = { x: 0.05, y: 0.4, visibility: 1 };
    }
    return points;
}

test('avatar maps all five states and requires stable input before switching', () => {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/avatar-pose-controller.js'), 'utf8'), context);
    const avatar = { dataset: {} };
    const controller = context.createAvatarPoseController(avatar);
    let timestamp = 0;
    for (const state of ['leftHandUp', 'rightHandUp', 'bothHandsUp', 'armsOpen', 'neutral']) {
        const previous = avatar.dataset.pose;
        controller.update(poseFixture(state), timestamp);
        controller.update(poseFixture(state), timestamp + 100);
        assert.equal(avatar.dataset.pose, previous);
        controller.update(poseFixture(state), timestamp + 220);
        assert.equal(avatar.dataset.pose, state);
        timestamp += 500;
    }
    for (let i = 0; i < 10; i++) controller.update(poseFixture(i % 2 ? 'leftHandUp' : 'rightHandUp'), timestamp + i * 70);
    assert.equal(avatar.dataset.pose, 'neutral', 'alternating results must not flicker');
    controller.update(poseFixture('bothHandsUp'), 4000);
    controller.update(poseFixture('bothHandsUp'), 4300);
    const obscured = poseFixture('bothHandsUp'); obscured[15].visibility = 0.1;
    controller.update(obscured, 4400);
    assert.equal(avatar.dataset.pose, 'neutral');
    controller.update(null, 4500);
    assert.equal(avatar.dataset.pose, 'neutral');
    const invalid = poseFixture('bothHandsUp'); invalid[11].x = NaN;
    controller.update(invalid, 4600);
    assert.equal(avatar.dataset.pose, 'neutral');
});
