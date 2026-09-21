const LEFT_ARM = [13, 15, 17, 19, 21];
const RIGHT_ARM = [14, 16, 18, 20, 22];
const LEFT_LEG = [25, 27, 29, 31];
const RIGHT_LEG = [26, 28, 30, 32];
const LOWER_BODY = [23, 24, ...LEFT_LEG, ...RIGHT_LEG];

function rotate(points, indices, pivotIndex, degrees) {
  const pivot = points[pivotIndex];
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  for (const index of indices) {
    const point = points[index];
    const x = point.x - pivot.x;
    const y = point.y - pivot.y;
    point.x = pivot.x + x * cosine - y * sine;
    point.y = pivot.y + x * sine + y * cosine;
  }
}

export function createPlayerPose(reference, options = {}) {
  if (!Array.isArray(reference)) return null;
  const settings = {
    translatePercent: 0,
    scalePercent: 100,
    leftArmDegrees: 0,
    rightArmDegrees: 0,
    legDegrees: 0,
    hideLowerBody: false,
    ...options
  };
  const scale = settings.scalePercent / 100;
  const translate = settings.translatePercent / 100;
  const points = reference.map(point => ({ ...point,
    x: 0.5 + (point.x - 0.5) * scale + translate,
    y: 0.5 + (point.y - 0.5) * scale,
    z: (point.z || 0) * scale
  }));

  rotate(points, LEFT_ARM, 11, settings.leftArmDegrees);
  rotate(points, RIGHT_ARM, 12, settings.rightArmDegrees);
  rotate(points, LEFT_LEG, 23, settings.legDegrees);
  rotate(points, RIGHT_LEG, 24, -settings.legDegrees);
  if (settings.hideLowerBody) {
    for (const index of LOWER_BODY) points[index].visibility = 0;
  }
  return points;
}

export function formatResult(result) {
  if (!result) return { similarity: '—', rating: '—', weight: '—' };
  return {
    similarity: result.similarity === null ? '—' : `${Math.round(result.similarity * 100)}%`,
    rating: result.rating[0].toUpperCase() + result.rating.slice(1),
    weight: result.comparedWeight.toFixed(2)
  };
}
