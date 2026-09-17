import copy
import unittest

from subject_tracking import select_sequence, features, pose_distance, coverage, is_near_black


def person(x=0.5, scale=0.2, arms='down', visibility=1):
    # All offsets are torso-relative: translation and scale preserve movement.
    joints = {11:(-.25,-1),12:(.25,-1),23:(-.2,0),24:(.2,0),
              13:(-.35,-.4),14:(.35,-.4),15:(-.4,.2),16:(.4,.2),
              25:(-.2,.7),26:(.2,.7),27:(-.2,1.4),28:(.2,1.4)}
    if arms == 'up':
        joints.update({13:(-.45,-1.7),14:(.45,-1.7),15:(-.5,-2.5),16:(.5,-2.5)})
    pose = [dict(x=x,y=.5,z=0,visibility=visibility) for _ in range(33)]
    for i,(dx,dy) in joints.items():
        pose[i].update(x=x+scale*dx,y=.5+scale*dy)
    return pose


def run(candidates, times=None, black=None):
    return select_sequence([dict(timeMs=times[i] if times else i*100,
                                 nearBlack=black[i] if black else False, candidates=poses)
                            for i,poses in enumerate(candidates)])[0]


class TrackingTests(unittest.TestCase):
    def test_one_person_and_empty_start(self):
        poses=[person(.4+i*.01) for i in range(10)]
        frames=run([[]]+[[p] for p in poses])
        self.assertIsNone(frames[0]['landmarks'])
        self.assertEqual([f['landmarks'] for f in frames[1:]],poses)

    def test_two_synchronized_people_prefer_current_and_ignore_order(self):
        a,b=person(.5),person(.8)
        rows=[[a,b] if i%2 else [b,a] for i in range(15)]
        frames=run(rows)
        self.assertTrue(all(f['landmarks']==a for f in frames))
        self.assertEqual(frames,run([list(reversed(row)) for row in rows]))

    def test_lateral_motion_is_not_a_hard_position_gate(self):
        poses=[person(.1+i*.08) for i in range(10)]
        self.assertEqual([f['landmarks'] for f in run([[p] for p in poses])],poses)

    def test_forward_backward_scale_is_normalized(self):
        poses=[person(scale=s) for s in (.10,.14,.19,.25,.32,.25,.19,.14,.10)]
        self.assertTrue(all(f['landmarks'] is not None for f in run([[p] for p in poses])))
        self.assertAlmostEqual(pose_distance(features(poses[0]),features(poses[4])),0)

    def test_normal_motion_does_not_accumulate_cost_and_favor_stationary_alternate(self):
        poses=[person(.2+i*.015) for i in range(20)]
        other=person(.9)
        frames=run([[poses[0]]]+[[p,other] for p in poses[1:]])
        self.assertEqual([f['landmarks'] for f in frames],poses)

    def test_synchronized_fallback_beats_null_and_switches_back_when_needed(self):
        a,b=person(.5),person(.8)
        frames=run([[a],[a,b],[b],[b],[a,b],[a]])
        self.assertEqual(frames[0]['landmarks'],a)
        self.assertEqual(frames[2]['landmarks'],b)
        self.assertEqual(frames[-1]['landmarks'],a)
        self.assertTrue(all(f['landmarks'] is not None for f in frames))

    def test_incompatible_fallback_stays_missing_and_cannot_reset_through_null(self):
        a,b=person(.5),person(.8,arms='up')
        frames=run([[a],[b],[],[b],[b]],times=[0,100,200,300,6000])
        self.assertEqual(frames[0]['landmarks'],a)
        self.assertTrue(all(f['landmarks'] is None for f in frames[1:]))

    def test_two_different_poses_keep_compatible_reference(self):
        a,b=person(.5),person(.8,arms='up')
        frames=run([[a]]+[[b,a] for _ in range(5)])
        self.assertTrue(all(f['landmarks']==a for f in frames))

    def test_crossing_synchronized_people_do_not_create_gaps(self):
        rows=[[person(.25+i*.05),person(.75-i*.05)] for i in range(11)]
        self.assertTrue(all(f['landmarks'] is not None for f in run(rows)))
        self.assertEqual(run(rows),run([list(reversed(row)) for row in rows]))

    def test_poor_visibility_falls_back_to_good_pose(self):
        a,b=person(.5),person(.8)
        poor=person(.5,visibility=.2)
        frames=run([[a],[poor,b],[poor,b],[b]])
        self.assertTrue(all(f['landmarks']==b for f in frames[1:]))
        self.assertIsNone(run([[poor]])[0]['landmarks'])

    def test_clearly_lower_quality_current_pose_can_switch_before_it_disappears(self):
        a,b=person(.5),person(.8)
        lower=person(.5,visibility=.72)
        frames=run([[a],[lower,b],[lower,b],[b]])
        self.assertEqual(frames[1]['landmarks'],b)

    def test_movement_limit_accounts_for_elapsed_time(self):
        a,b=person(),person(arms='up')
        for p,q in zip(b,a):
            p['y']=q['y']+.8*(p['y']-q['y'])
        distance=pose_distance(features(a),features(b))
        self.assertGreater(distance,.85)
        self.assertLess(distance,1.1)
        self.assertIsNone(run([[a],[b]],times=[0,100])[-1]['landmarks'])
        self.assertEqual(run([[a],[b]],times=[0,300])[-1]['landmarks'],b)

    def test_no_candidates_and_black_with_candidates_stay_missing(self):
        self.assertTrue(all(f['landmarks'] is None for f in run([[],[]])))
        self.assertTrue(all(f['landmarks'] is None for f in run([[person()]]*5,black=[True]*5)))

    def test_ambiguous_conflicting_initial_poses_wait_for_evidence(self):
        a,b=person(.3),person(.7,arms='up')
        self.assertIsNone(run([[a,b]])[0]['landmarks'])
        self.assertEqual(run([[a,b]]),run([[b,a]]))

    def test_same_pose_returns_after_long_detection_loss(self):
        a,b=person(.5),person(.8)
        frames=run([[a],[],[b]],times=[0,100,6000])
        self.assertEqual(frames[-1]['landmarks'],b)

    def test_bad_points_and_timestamps_rejected(self):
        bad=copy.deepcopy(person());bad[15]['x']=float('nan')
        self.assertIsNone(features(bad))
        with self.assertRaises(ValueError):
            run([[person()],[person()]],times=[100,100])

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
