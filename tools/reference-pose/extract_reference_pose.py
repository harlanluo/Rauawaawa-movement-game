"""Preprocess one constant-frame-rate exercise video; never called by gameplay."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import time
import urllib.request
from collections import Counter

from validate_reference_pose import validate
from subject_tracking import SubjectTracker, SETTINGS, BLACK_SETTINGS, is_near_black, coverage

MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'
MODEL_SHA256 = '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1'


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def extract(source, output, fps, model, debug=None):
    import cv2
    import mediapipe as mp

    started = time.perf_counter()
    if source.resolve() == output.resolve() or model.resolve() == output.resolve():
        raise ValueError('Output must differ from input and model')
    if debug and debug.resolve() in (source.resolve(), output.resolve(), model.resolve()):
        raise ValueError('Debug output must differ from input, output and model')
    if not source.is_file():
        raise ValueError(f'Input does not exist: {source}')
    if not math.isfinite(fps) or not 0 < fps <= 1000:
        raise ValueError('FPS must be finite and between 0 and 1000')
    capture = cv2.VideoCapture(str(source))
    try:
        if not capture.isOpened():
            raise ValueError('Cannot open video')
        source_fps = capture.get(cv2.CAP_PROP_FPS)
        expected_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        if not math.isfinite(source_fps) or source_fps <= 0 or fps > source_fps:
            raise ValueError('Target FPS must not exceed valid source FPS')
        if not model.exists():
            model.parent.mkdir(parents=True, exist_ok=True)
            temporary = model.with_suffix('.download')
            try:
                with urllib.request.urlopen(MODEL_URL, timeout=60) as response:
                    temporary.write_bytes(response.read())
                temporary.replace(model)
            finally:
                temporary.unlink(missing_ok=True)
        if sha256(model) != MODEL_SHA256:
            raise ValueError('Model checksum mismatch: expected official Full float16 version 1')
        options = mp.tasks.vision.PoseLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(model.resolve()),
                                             delegate=mp.tasks.BaseOptions.Delegate.CPU),
            running_mode=mp.tasks.vision.RunningMode.VIDEO, num_poses=SETTINGS['maxCandidates'],
            min_pose_detection_confidence=0.5, min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5, output_segmentation_masks=False)
        frames, count, width, height = [], 0, None, None
        tracker, black, reasons = SubjectTracker(), [], Counter()
        diagnostics = [] if debug else None
        with mp.tasks.vision.PoseLandmarker.create_from_options(options) as landmarker:
            while True:
                ok, bgr = capture.read()
                if not ok:
                    break
                timestamp = count * 1000 / source_fps
                # Reject variable or unusable presentation timing instead of silently retiming it.
                decoded_time = capture.get(cv2.CAP_PROP_POS_MSEC)
                if not math.isfinite(decoded_time) or abs(decoded_time - timestamp) > 2:
                    raise ValueError('Unsupported variable/missing frame timestamps; convert to constant FPS first')
                count += 1
                current_height, current_width = bgr.shape[:2]
                if width is not None and (current_width, current_height) != (width, height):
                    raise ValueError('Video dimensions changed')
                width, height = current_width, current_height
                if timestamp + 1e-6 < len(frames) * 1000 / fps:
                    continue
                result = landmarker.detect_for_video(
                    mp.Image(image_format=mp.ImageFormat.SRGB,
                             data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)), round(timestamp))
                candidates = [[{axis: getattr(point, axis) for axis in ('x', 'y', 'z', 'visibility')}
                               for point in candidate] for candidate in result.pose_landmarks]
                gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
                dark = is_near_black(float(gray.mean()), float((gray > BLACK_SETTINGS['brightLuma']).mean()))
                black.append(dark)
                pose = tracker.select([] if dark else candidates, round(timestamp))
                reasons['near-black' if dark else tracker.reason] += 1
                if diagnostics is not None:
                    diagnostics.append(dict(timeMs=round(timestamp), nearBlack=dark,
                                            reason=tracker.reason, candidates=candidates))
                frames.append({'timeMs': round(timestamp), 'landmarks': pose})
                if len(frames) % 100 == 0:
                    print(f'Processed {len(frames)} samples ({timestamp / 1000:.1f}s)', flush=True)
        if count == 0 or (expected_count > 0 and count != expected_count):
            raise ValueError(f'Incomplete decode: {count} frames, expected {expected_count}')
        duration = count * 1000 / source_fps
        usable, inactive = coverage([frame['timeMs'] for frame in frames], black, duration)
        data = {'formatVersion': 1, 'sourceVideo': source.as_posix(),
                'subjectTracking': SETTINGS,
                'coverage': {**BLACK_SETTINGS, 'rangeConvention': 'start-inclusive-end-exclusive',
                             'inactiveRanges': inactive}, 'usableRanges': usable,
                'sourceSha256': sha256(source),
                'poseModel': {'profile': 'Full float16', 'url': MODEL_URL,
                              'sha256': sha256(model), 'mediapipeVersion': mp.__version__,
                              'runningMode': 'VIDEO', 'delegate': 'CPU', 'numPoses': SETTINGS['maxCandidates'],
                              'minPoseDetectionConfidence': 0.5, 'minPosePresenceConfidence': 0.5,
                              'minTrackingConfidence': 0.5},
                'video': {'durationMs': count * 1000 / source_fps, 'width': width, 'height': height,
                          'sourceFps': source_fps, 'decodedFrames': count},
                'sampling': {'targetFps': fps, 'strategy': 'first-frame-at-or-after-grid',
                             'timestampBasis': 'zero-based-constant-frame-rate',
                             'decoder': 'OpenCV', 'decoderVersion': cv2.__version__},
                'frames': frames}
        summary = validate(data)
        encoded = json.dumps(data, allow_nan=False, separators=(',', ':')) + '\n'
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_suffix(output.suffix + '.tmp')
        try:
            temporary.write_text(encoded, encoding='utf-8')
            temporary.replace(output)
        finally:
            temporary.unlink(missing_ok=True)
        summary.update(outputBytes=output.stat().st_size, runtimeSeconds=time.perf_counter() - started)
        summary.update(trackingReasons=dict(reasons), usableRanges=usable, inactiveRanges=inactive)
        print(json.dumps(summary, indent=2))
        if debug:
            debug.parent.mkdir(parents=True, exist_ok=True)
            debug.write_text(json.dumps(diagnostics, allow_nan=False), encoding='utf-8')
    finally:
        capture.release()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--fps', type=float, default=10)
    parser.add_argument('--debug', type=Path, help='Optional candidate diagnostics; do not commit')
    parser.add_argument('--model', type=Path, default=Path(__file__).with_name('pose_landmarker_full.task'),
                        help='Cached official Full float16 model; downloaded if absent')
    args = parser.parse_args()
    extract(args.input, args.output, args.fps, args.model, args.debug)
