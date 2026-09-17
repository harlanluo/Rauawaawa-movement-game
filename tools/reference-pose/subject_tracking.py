"""Pose continuity across synchronized demonstrators; offline preprocessing only."""
import math

TORSO = (11, 12, 23, 24)
MAJOR = (11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28)
SETTINGS = dict(strategy='normalized-pose-sequence-v2', maxCandidates=4,
                minTorsoVisibility=0.5, minJointVisibility=0.5,
                minReliableJoints=8, minMeanVisibility=0.7,
                basePoseDistance=0.65, poseDistancePerSecond=2.0,
                maxPoseDistance=1.1, sameSubjectWeight=0.25,
                poseContinuityWeight=0.25, futureSupportWeight=0.1,
                ambiguityMargin=0.04, conflictingPoseDistance=0.9,
                lookAheadMs=200, beamWidth=16, missingCost=0.8)
BLACK_SETTINGS = dict(strategy='sustained-near-black-v1', maxMeanLuma=3,
                      maxBrightFraction=0.005, brightLuma=12, minDurationMs=500)


def features(pose, aspect=1.0):
    if len(pose) != 33 or any(not isinstance(p, dict) or any(
            not isinstance(p.get(a), (int, float)) or not math.isfinite(p[a])
            for a in ('x', 'y', 'z', 'visibility')) for p in pose):
        return None
    if any(pose[i]['visibility'] < SETTINGS['minTorsoVisibility'] for i in TORSO):
        return None
    if any(not 0 <= p['visibility'] <= 1 for p in pose):
        return None
    visibility = [pose[i]['visibility'] for i in MAJOR]
    quality = sum(visibility) / len(MAJOR)
    if (quality < SETTINGS['minMeanVisibility'] or
            sum(v >= SETTINGS['minJointVisibility'] for v in visibility) < SETTINGS['minReliableJoints']):
        return None
    points = [(pose[i]['x'] * aspect, pose[i]['y']) for i in MAJOR]
    shoulder = tuple((points[0][k] + points[1][k]) / 2 for k in (0, 1))
    hip = tuple((points[6][k] + points[7][k]) / 2 for k in (0, 1))
    scale = math.dist(shoulder, hip)
    if scale < 0.03:
        return None
    normalized = [tuple((p[k] - hip[k]) / scale for k in (0, 1)) for p in points]
    return dict(pose=pose, center=hip, scale=scale, normalized=normalized,
                visibility=visibility, quality=quality,
                key=tuple(p[a] for p in pose for a in ('x', 'y', 'z', 'visibility')))


def pose_distance(a, b):
    # Preserve anatomical left/right and lean: no mirroring or rotation matching.
    shared = [(p, q, min(v, w)) for p, q, v, w in zip(
        a['normalized'], b['normalized'], a['visibility'], b['visibility'])
        if min(v, w) >= SETTINGS['minJointVisibility']]
    if len(shared) < SETTINGS['minReliableJoints']:
        return math.inf
    return math.sqrt(sum(weight * math.dist(p, q)**2 for p, q, weight in shared)
                     / sum(weight for _, _, weight in shared))


def motion_limit(elapsed_ms):
    return min(SETTINGS['maxPoseDistance'], SETTINGS['basePoseDistance']
               + SETTINGS['poseDistancePerSecond'] * elapsed_ms / 1000)


def association_distance(previous, candidate, elapsed_ms):
    """Rank likely current demonstrator; never reject a pose for screen motion."""
    seconds = elapsed_ms / 1000
    shift = math.dist(previous['center'], candidate['center']) / previous['scale']
    size = abs(math.log(candidate['scale'] / previous['scale']))
    return shift / (0.3 + 2 * seconds) + size / (0.2 + seconds)


def continuity_cost(previous, candidate, elapsed_ms, same_subject):
    distance = pose_distance(previous, candidate)
    if distance > motion_limit(elapsed_ms):
        return None
    # Do not charge each lateral step: that would favor a stationary alternate
    # through accumulated costs even when the current demonstrator is reliable.
    preference = 0 if same_subject else 1
    return (SETTINGS['poseContinuityWeight'] * distance
            + SETTINGS['sameSubjectWeight'] * preference)


def select_sequence(samples, aspect=1.0):
    """Bounded Viterbi search. Null states remember the last accepted pose.

    One deterministic initial anchor prevents the optimizer discarding a good
    opening merely to follow an incompatible later person. Subsequent choices
    use the whole sequence, retaining up to beamWidth histories per sample.
    """
    prepared = []
    if not math.isfinite(aspect) or aspect <= 0:
        raise ValueError('Aspect ratio must be positive and finite')
    previous_time = -1
    for sample in samples:
        if sample['timeMs'] <= previous_time:
            raise ValueError('Reference sample times must increase')
        previous_time = sample['timeMs']
        candidates = [] if sample['nearBlack'] else sample['candidates']
        prepared.append(sorted((f for p in candidates if (f := features(p, aspect)) is not None),
                               key=lambda f: f['key']))
    # State: total cost, last accepted features/time, backpointer, output, reason.
    states = [(0.0, None, None, None, None, 'initial')]
    anchored = False
    for index, (sample, candidates) in enumerate(zip(samples, prepared)):
        time_ms = sample['timeMs']
        next_time = samples[index+1]['timeMs'] if index+1 < len(samples) else time_ms
        future = prepared[index+1] if index+1 < len(samples) else []
        supported = []
        for candidate in candidates:
            support = 0.0
            if future and 0 < next_time-time_ms <= SETTINGS['lookAheadMs']:
                support = min(pose_distance(candidate, f) for f in future)
                if support > motion_limit(next_time-time_ms):
                    continue
            supported.append((candidate, 1-candidate['quality'] + SETTINGS['futureSupportWeight']*support))
        if not anchored and candidates:
            # Anchor independently of following candidates: future incompatible
            # motion must not persuade the optimizer to drop a valid opening.
            initial = sorted(((c, 1-c['quality']) for c in candidates), key=lambda item: (item[1],
                abs(item[0]['center'][0]/aspect-.5), item[0]['key']))
            conflict = (len(initial)>1 and abs(initial[1][1]-initial[0][1])<SETTINGS['ambiguityMargin']
                        and pose_distance(initial[0][0],initial[1][0])>SETTINGS['conflictingPoseDistance'])
            if not conflict:
                candidate, cost = initial[0]
                states = [(states[0][0]+cost, candidate, time_ms, states[0], candidate['pose'], 'selected')]
                anchored = True
                continue
        best_candidates, missing_states = {}, []
        for state in states:
            ranked = []
            if anchored:
                current = min(supported, key=lambda item: (
                    association_distance(state[1], item[0], time_ms-state[2]), item[0]['key']))[0] if supported else None
                for candidate, quality_cost in supported:
                    cost = continuity_cost(state[1], candidate, time_ms-state[2], candidate is current)
                    if cost is not None:
                        ranked.append((cost+quality_cost, candidate))
            ranked.sort(key=lambda item: (item[0],item[1]['key']))
            conflict = (len(ranked)>1 and ranked[1][0]-ranked[0][0]<SETTINGS['ambiguityMargin']
                        and pose_distance(ranked[0][1],ranked[1][1])>SETTINGS['conflictingPoseDistance'])
            reason = ('near-black' if sample['nearBlack'] else 'no-quality-candidate' if not candidates
                      else 'conflicting-poses' if conflict or not anchored else 'inconsistent-movement')
            if not conflict:
                for cost, candidate in ranked:
                    node = (state[0]+cost, candidate, time_ms, state, candidate['pose'], 'selected')
                    old = best_candidates.get(candidate['key'])
                    if old is None or node[0] < old[0]:
                        best_candidates[candidate['key']] = node
            # Do not reset pose memory after a gap or let null bypass continuity.
            penalty = SETTINGS['missingCost'] if candidates and not sample['nearBlack'] else 0.0
            missing_states.append((state[0]+penalty, state[1], state[2], state, None,
                                   'sequence-rejection' if ranked and not conflict else reason))
        states = sorted(list(best_candidates.values())+missing_states, key=lambda node: node[0])[:SETTINGS['beamWidth']]
    node = min(states, key=lambda state: state[0])
    frames, reasons = [], []
    for sample in reversed(samples):
        frames.append(dict(timeMs=sample['timeMs'], landmarks=node[4]))
        reasons.append(node[5])
        node = node[3]
    return list(reversed(frames)), list(reversed(reasons))


def is_near_black(mean_luma, bright_fraction):
    return (mean_luma <= BLACK_SETTINGS['maxMeanLuma']
            and bright_fraction <= BLACK_SETTINGS['maxBrightFraction'])


def coverage(times, black, duration_ms):
    """Half-open ranges on source timeline. Only sustained black runs excluded."""
    inactive = []
    start = None
    for index in range(len(times) + 1):
        dark = index < len(times) and black[index]
        if dark and start is None:
            start = times[index]
        if not dark and start is not None:
            end = times[index] if index < len(times) else duration_ms
            if end - start >= BLACK_SETTINGS['minDurationMs']:
                inactive.append(dict(startMs=start, endMs=end))
            start = None
    usable, cursor = [], 0
    for span in inactive:
        if cursor < span['startMs']:
            usable.append(dict(startMs=cursor, endMs=span['startMs']))
        cursor = span['endMs']
    if cursor < duration_ms:
        usable.append(dict(startMs=cursor, endMs=duration_ms))
    return usable, inactive
