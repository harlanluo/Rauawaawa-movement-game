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

async function harness({ raf = false, gpuFails = false, cpuFails = false, permission, forceCPU = false } = {}) {
    const callbacks = new Map();
    const streams = [];
    const delegates = [];
    const statuses = [];
    let id = 0, now = 0, detections = 0, closed = 0, requests = 0;
    let detectionError = false;
    const video = {
        readyState: 2, currentTime: 0, videoWidth: 640, videoHeight: 480,
        setAttribute() {}, pause() {}, play: async () => {}, srcObject: null
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
        navigator: { mediaDevices: { getUserMedia: async constraints => {
            requests++;
            assert.equal(constraints.audio, false);
            assert.equal(constraints.video.width.ideal, 640);
            if (permission) return permission(newStream);
            return newStream();
        } } },
        requestAnimationFrame: request, cancelAnimationFrame: cancel,
        performance: { now: () => now }, console: { warn() {} }
    });
    const library = new vm.SyntheticModule(['FilesetResolver', 'PoseLandmarker'], function() {
        this.setExport('FilesetResolver', { forVisionTasks: async () => ({}) });
        this.setExport('PoseLandmarker', { createFromOptions: async (files, options) => {
            const delegate = options.baseOptions.delegate;
            delegates.push(delegate);
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
                return { landmarks: [Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }))] };
            }, close() { closed++; } };
        } });
    }, { context });
    await library.link(() => {});
    await library.evaluate();
    const module = new vm.SourceTextModule(source, { context, importModuleDynamically: () => library });
    await module.link(() => {});
    await module.evaluate();
    const tracker = module.namespace.createPoseTracker({ forceCPU, onStatus: status => statuses.push(status) });
    return { tracker, video, callbacks, streams, delegates, statuses,
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
        setTimeout, clearTimeout
    });
    const module = new vm.SyntheticModule(['createPoseTracker'], function() {
        this.setExport('createPoseTracker', () => h.tracker);
    }, { context });
    await module.link(() => {}); await module.evaluate();
    const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
    new vm.Script(app, { importModuleDynamically: () => module }).runInContext(context);
    vm.runInContext('triggerConfetti = () => {};', context);
    async function start(action = 'startGame(1)') {
        vm.runInContext(action, context);
        for (let i = 0; i < 20 && h.callbacks.size === 0; i++) await new Promise(r => setImmediate(r));
        assert.equal(h.callbacks.size, 1);
        assert.equal(h.streams.filter(s => s.getTracks()[0].readyState === 'live').length, 1);
    }
    function released() {
        assert.ok(h.streams.every(s => s.getTracks()[0].readyState === 'ended'));
        assert.equal(h.callbacks.size, 0);
        assert.equal(h.video.srcObject, null);
    }
    await start();
    vm.runInContext('togglePauseGame()', context); assert.equal(h.callbacks.size, 0);
    vm.runInContext('togglePauseGame()', context); assert.equal(h.callbacks.size, 1);
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
