import copy
import unittest

from validate_reference_pose import validate


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.data = {'formatVersion': 1, 'sourceVideo': 'test.mp4',
                     'poseModel': dict.fromkeys(('profile', 'sha256', 'mediapipeVersion', 'url'), 'test'),
                     'video': {'durationMs': 200, 'width': 640, 'height': 480,
                               'sourceFps': 30, 'decodedFrames': 6},
                     'sampling': {'targetFps': 10},
                     'frames': [{'timeMs': 0, 'landmarks': [dict(x=0.1, y=0.2, z=-0.3, visibility=0.01)
                                                         for _ in range(33)]},
                                {'timeMs': 100, 'landmarks': None}]}

    def test_missing_and_low_visibility_are_preserved(self):
        original = copy.deepcopy(self.data)
        summary = validate(self.data)
        self.assertEqual(summary['detectedSamples'], 1)
        self.assertEqual(summary['missingSamples'], 1)
        self.assertEqual(self.data, original)

    def test_corruptions_are_rejected(self):
        changes = [lambda d: d.update(formatVersion=2),
                   lambda d: d['frames'][1].update(timeMs=0),
                   lambda d: d['frames'][1].update(timeMs=200),
                   lambda d: d['frames'][0]['landmarks'].pop(),
                   lambda d: d['frames'][0]['landmarks'][0].update(x=float('nan')),
                   lambda d: d['frames'][0]['landmarks'][0].update(z=float('inf')),
                   lambda d: d['frames'][0]['landmarks'][0].update(y='0.2'),
                   lambda d: d['frames'][0]['landmarks'][0].pop('visibility'),
                   lambda d: d['frames'][1].pop('landmarks'),
                   lambda d: d['sampling'].update(targetFps=0),
                   lambda d: d['video'].update(durationMs=1000)]
        for change in changes:
            with self.subTest(change=change):
                data = copy.deepcopy(self.data)
                change(data)
                with self.assertRaises(ValueError):
                    validate(data)

    def test_optional_coverage_partitions_timeline_and_rejects_pose_in_black(self):
        self.data['usableRanges'] = [dict(startMs=0, endMs=100)]
        self.data['coverage'] = dict(rangeConvention='start-inclusive-end-exclusive',
                                     inactiveRanges=[dict(startMs=100, endMs=200)])
        validate(self.data)
        for field, value in [('startMs', -1), ('startMs', 101), ('endMs', 201), ('endMs', 0)]:
            bad = copy.deepcopy(self.data)
            bad['coverage']['inactiveRanges'][0][field] = value
            with self.assertRaises(ValueError):
                validate(bad)
        bad = copy.deepcopy(self.data)
        bad['frames'][1]['landmarks'] = bad['frames'][0]['landmarks']
        with self.assertRaises(ValueError):
            validate(bad)


if __name__ == '__main__':
    unittest.main()
