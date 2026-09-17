"""Small, conservative geometric tracker; no appearance or identity recognition."""
import math

TORSO = (11, 12, 23, 24)
SETTINGS = dict(strategy='torso-continuity-v1', maxCandidates=4,
                minTorsoVisibility=0.5, maxCenterDistance=0.08,
                maxCenterBodyLengths=0.4, maxScaleRatio=1.35,
                maxTorsoDisplacement=0.6, ambiguityMargin=0.2,
                maxReacquisitionMs=5000)
BLACK_SETTINGS = dict(strategy='sustained-near-black-v1', maxMeanLuma=3,
                      maxBrightFraction=0.005, brightLuma=12, minDurationMs=500)


def geometry(pose):
    if len(pose) != 33 or any(pose[i]['visibility'] < SETTINGS['minTorsoVisibility'] for i in TORSO):
        return None
    points = [(pose[i]['x'], pose[i]['y']) for i in TORSO]
    center = tuple(sum(p[k] for p in points) / 4 for k in (0, 1))
    shoulder = tuple((points[0][k] + points[1][k]) / 2 for k in (0, 1))
    hip = tuple((points[2][k] + points[3][k]) / 2 for k in (0, 1))
    scale = math.dist(shoulder, hip)
    return (center, scale, points) if scale > 0.03 else None


class SubjectTracker:
    def __init__(self):
        self.last = None
        self.last_time = None
        self.reason = 'not-initialized'

    def select(self, candidates, time_ms):
        usable = [(pose, geometry(pose)) for pose in candidates]
        usable = [(pose, geo) for pose, geo in usable if geo is not None]
        if self.last is None:
            if not usable:
                self.reason = 'no-usable-candidate'
                return None
            # Visible full-body, central, prominent. Coordinate tuple breaks ties,
            # never the detector's array order.
            def initial(item):
                pose, (center, scale, _) = item
                full = sum(pose[i]['visibility'] for i in (0, 11, 12, 23, 24, 27, 28)) / 7
                return (abs(center[0] - 0.5) + 0.2 * abs(center[1] - 0.5)
                        - 0.3 * scale - 0.08 * full,
                        tuple(p[a] for p in pose for a in ('x', 'y', 'z', 'visibility')))
            pose, geo = min(usable, key=initial)
        else:
            if time_ms - self.last_time > SETTINGS['maxReacquisitionMs']:
                self.reason = 'identity-expired'
                return None
            center, scale, points = self.last
            ranked = []
            for pose, geo in usable:
                distance = math.dist(center, geo[0])
                ratio = max(scale / geo[1], geo[1] / scale)
                displacement = sum(math.dist(a, b) for a, b in zip(points, geo[2])) / (4 * scale)
                if (distance > min(SETTINGS['maxCenterDistance'], scale * SETTINGS['maxCenterBodyLengths'])
                        or ratio > SETTINGS['maxScaleRatio']
                        or displacement > SETTINGS['maxTorsoDisplacement']):
                    continue
                score = distance / scale + abs(math.log(ratio)) + 0.5 * displacement
                ranked.append((score, pose, geo))
            ranked.sort(key=lambda item: item[0])
            if not ranked:
                self.reason = 'no-continuity-match'
                return None
            if len(ranked) > 1 and ranked[1][0] - ranked[0][0] < SETTINGS['ambiguityMargin']:
                self.reason = 'ambiguous'
                return None
            _, pose, geo = ranked[0]
        self.last, self.last_time = geo, time_ms
        self.reason = 'selected'
        return pose


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
