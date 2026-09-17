"""Dependency-free format v1 validation and extraction summary."""
import argparse
import json
import math


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate(data):
    def check_finite(value):
        if isinstance(value, dict):
            for child in value.values():
                check_finite(child)
        elif isinstance(value, list):
            for child in value:
                check_finite(child)
        elif isinstance(value, float):
            require(math.isfinite(value), 'Non-finite value')
    check_finite(data)
    require(type(data.get('formatVersion')) is int and data['formatVersion'] == 1,
            'Unsupported formatVersion')
    require(isinstance(data.get('sourceVideo'), str) and data['sourceVideo'], 'Missing sourceVideo')
    for key in ('profile', 'sha256', 'mediapipeVersion', 'url'):
        require(isinstance(data['poseModel'].get(key), str) and data['poseModel'][key], f'Missing model {key}')
    video, sampling, frames = data['video'], data['sampling'], data['frames']
    for key in ('durationMs', 'width', 'height', 'sourceFps', 'decodedFrames'):
        require(number(video[key]) and video[key] > 0, f'Invalid video {key}')
    if 'usableRanges' in data or 'coverage' in data:
        require(isinstance(data.get('coverage'), dict), 'Missing coverage metadata')
        require(data['coverage'].get('rangeConvention') == 'start-inclusive-end-exclusive', 'Invalid range convention')
        ranges = []
        for spans in (data.get('usableRanges'), data['coverage'].get('inactiveRanges')):
            require(isinstance(spans, list), 'Invalid coverage ranges')
            previous_end = -1
            for span in spans:
                require(isinstance(span, dict), 'Invalid coverage range')
                start, end = span.get('startMs'), span.get('endMs')
                require(number(start) and number(end) and 0 <= start < end <= video['durationMs']
                        and start >= previous_end, 'Invalid coverage range')
                previous_end = end
                ranges.append((start, end))
        cursor = 0
        for start, end in sorted(ranges):
            require(start == cursor, 'Coverage must partition the source timeline')
            cursor = end
        require(cursor == video['durationMs'], 'Incomplete coverage metadata')
    fps = sampling['targetFps']
    require(number(fps) and 0 < fps <= min(1000, video['sourceFps']), 'Invalid targetFps')
    require(isinstance(frames, list) and len(frames) > 0, 'No samples')
    previous, detected = -1, 0
    tolerance = 1000 / video['sourceFps'] + 2
    for index, frame in enumerate(frames):
        timestamp = frame['timeMs']
        require(type(timestamp) is int and previous < timestamp < video['durationMs'], 'Invalid timestamp')
        require(abs(timestamp - index * 1000 / fps) <= tolerance, 'Sample outside target schedule')
        previous = timestamp
        require('landmarks' in frame, 'Missing explicit landmarks field')
        pose = frame['landmarks']
        if 'coverage' in data:
            require(pose is None or not any(r['startMs'] <= timestamp < r['endMs']
                    for r in data['coverage']['inactiveRanges']), 'Pose in inactive range')
        if pose is None:
            continue
        require(isinstance(pose, list) and len(pose) == 33, 'Expected 33 landmarks')
        detected += 1
        for landmark in pose:
            require(all(number(landmark.get(axis)) for axis in ('x', 'y', 'z')), 'Invalid coordinates')
            require('visibility' in landmark, 'Missing visibility')
            visibility = landmark['visibility']
            require(visibility is None or (number(visibility) and 0 <= visibility <= 1), 'Invalid visibility')
    require(video['durationMs'] - frames[-1]['timeMs'] <= 1000 / fps + tolerance, 'Incomplete sampling')
    return {'durationMs': video['durationMs'], 'totalSamples': len(frames),
            'detectedSamples': detected, 'detectedPercent': 100 * detected / len(frames),
            'missingSamples': len(frames) - detected,
            'effectiveFps': len(frames) * 1000 / video['durationMs'],
            'firstTimeMs': frames[0]['timeMs'], 'lastTimeMs': frames[-1]['timeMs']}


def load(path):
    def reject(value):
        raise ValueError(f'Non-finite JSON value: {value}')
    with open(path, encoding='utf-8') as stream:
        return json.load(stream, parse_constant=reject)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input')
    args = parser.parse_args()
    print(json.dumps(validate(load(args.input)), indent=2))
