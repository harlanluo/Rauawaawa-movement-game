import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVideoRecorder } from '../js/video-recorder.js';

function fixture(getUserMedia) {
    const states = [], completed = [];
    const track = { stopped: 0, stop() { this.stopped++; } };
    const stream = { getTracks: () => [track] };
    class Recorder {
        static isTypeSupported(type) { return type.includes('webm'); }
        constructor() { this.state = 'inactive'; }
        start() { this.state = 'recording'; }
        stop() {
            this.state = 'inactive';
            queueMicrotask(() => {
                this.ondataavailable({ data: new Blob(['video']) });
                this.onstop();
            });
        }
    }
    const video = { play: async () => {}, load() {}, removeAttribute() {} };
    const controller = createVideoRecorder({ video, Recorder,
        mediaDevices: { getUserMedia: getUserMedia || (async () => stream) },
        onState: (state, message) => states.push({ state, message }), onTime() {},
        normalize: async blob => new File([blob], 'recording.mp4', {type:'video/mp4'}),
        onComplete: file => completed.push(file)
    });
    return { controller, states, completed, track, stream, video };
}

test('stopping recording releases camera and prepares a playable file', async () => {
    const f = fixture();
    await f.controller.start();
    assert.equal(f.controller.getState(), 'recording');
    f.controller.stop();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.controller.getState(), 'ready');
    assert.equal(f.track.stopped, 1);
    assert.equal(f.video.srcObject, null);
    assert.equal(f.completed[0].type, 'video/mp4');
    assert.equal(f.video.controls, true);
    f.controller.reset();
});

test('leaving during camera permission closes the late stream', async () => {
    let grant;
    const f = fixture(() => new Promise(resolve => { grant = resolve; }));
    const pending = f.controller.start();
    f.controller.reset();
    grant(f.stream);
    await pending;
    assert.equal(f.track.stopped, 1);
    assert.equal(f.controller.getState(), 'idle');
    assert.equal(f.completed.length, 0);
});

test('retake discards the previous recording instead of publishing stale output', async () => {
    const f = fixture();
    await f.controller.start();
    f.controller.stop();
    f.controller.reset();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.completed.length, 0);
    assert.equal(f.controller.getState(), 'idle');
});

test('microphone is off by default and denied permission leaves a retryable state', async () => {
    let constraints;
    const f = fixture(async options => {
        constraints = options;
        throw new DOMException('Denied', 'NotAllowedError');
    });
    await f.controller.start();
    assert.equal(constraints.audio, false);
    assert.equal(f.controller.getState(), 'error');
    assert.match(f.states.at(-1).message, /denied/);
    await f.controller.start({audio:true});
    assert.equal(constraints.audio, true);
    f.controller.reset();
});
