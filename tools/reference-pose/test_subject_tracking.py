import copy
import unittest

from subject_tracking import SubjectTracker, coverage, is_near_black


def person(x=0.5, scale=0.2):
    pose = [dict(x=x, y=0.5, z=0, visibility=1) for _ in range(33)]
    for i, dx, dy in ((11, -.05, -.5), (12, .05, -.5), (23, -.04, .5), (24, .04, .5)):
        pose[i].update(x=x+dx, y=.5+dy*scale)
    return pose


class TrackingTests(unittest.TestCase):
    def test_one_person_and_empty_start(self):
        tracker = SubjectTracker()
        self.assertIsNone(tracker.select([], 0))
        for i in range(10):
            pose = person(.5 + i*.002)
            self.assertIs(tracker.select([pose], 100+i*100), pose)

    def test_initial_and_continuing_order_independence(self):
        left, right = person(.3), person(.6)
        for initial in ([left, right], [right, left]):
            tracker = SubjectTracker()
            self.assertIs(tracker.select(initial, 0), right)
            for index in range(20):
                candidates = [left, right] if index % 2 else [right, left]
                self.assertIs(tracker.select(candidates, 100*(index+1)), right)

    def test_exact_initial_tie_has_geometric_tiebreak(self):
        left, right = person(.25), person(.75)
        self.assertEqual(SubjectTracker().select([left, right], 0),
                         SubjectTracker().select([right, left], 0))

    def test_disappearance_does_not_select_remaining_person_and_return_matches(self):
        tracker = SubjectTracker()
        tracked, other = person(.6), person(.3)
        tracker.select([tracked, other], 0)
        for time in (100, 1000, 4000):
            self.assertIsNone(tracker.select([other], time))
        returned = person(.61)
        self.assertIs(tracker.select([other, returned], 4500), returned)

    def test_long_loss_never_reinitializes(self):
        tracker = SubjectTracker()
        tracker.select([person()], 0)
        self.assertIsNone(tracker.select([person()], 5001))
        self.assertIsNone(tracker.select([person()], 6000))
        self.assertEqual(tracker.reason, 'identity-expired')

    def test_ambiguous_return_stays_missing_in_both_orders(self):
        for poses in ([person(.49), person(.51)], [person(.51), person(.49)]):
            tracker = SubjectTracker()
            tracker.select([person()], 0)
            tracker.select([], 100)
            self.assertIsNone(tracker.select(poses, 500))
            self.assertEqual(tracker.reason, 'ambiguous')
            self.assertEqual(tracker.last_time, 0)

    def test_crossing_close_candidates_are_rejected(self):
        tracker = SubjectTracker()
        tracker.select([person(.5), person(.8)], 0)
        self.assertIsNone(tracker.select([person(.48), person(.52)], 100))
        self.assertIsNone(tracker.select([person(.52), person(.48)], 200))

    def test_scale_jump_far_candidate_low_visibility_and_no_candidates(self):
        tracker = SubjectTracker()
        tracker.select([person()], 0)
        low = copy.deepcopy(person()); low[23]['visibility'] = .1
        for candidates in ([person(.8)], [person(scale=.3)], [low], []):
            self.assertIsNone(tracker.select(candidates, 100))

    def test_black_threshold_ignores_dim_or_partly_bright_images(self):
        self.assertTrue(is_near_black(0, 0))
        self.assertTrue(is_near_black(3, .005))
        self.assertFalse(is_near_black(4, 0))
        self.assertFalse(is_near_black(2, .01))

    def test_sustained_black_only_and_original_half_open_timeline(self):
        times = list(range(0, 1500, 100))
        flags = [False, True, True, False] + [True]*6 + [False]*5
        self.assertEqual(coverage(times, flags, 1500),
                         ([dict(startMs=0,endMs=400), dict(startMs=1000,endMs=1500)],
                          [dict(startMs=400,endMs=1000)]))
        self.assertEqual(coverage(times, [True]*15, 1500),
                         ([], [dict(startMs=0,endMs=1500)]))
        self.assertEqual(coverage(times, [False]*15, 1500),
                         ([dict(startMs=0,endMs=1500)], []))


if __name__ == '__main__':
    unittest.main()
