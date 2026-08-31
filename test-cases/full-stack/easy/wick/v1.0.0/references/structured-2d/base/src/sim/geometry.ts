// Wick — the shapes and the overlap rules (specs/weapons.md "Shapes and
// overlap", specs/world.md).

export interface Vec {
  x: number;
  y: number;
}

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The unit vector of `v`, or `null` for a zero vector. */
export function unit(v: Vec): Vec | null {
  const length = Math.hypot(v.x, v.y);
  if (length === 0) return null;
  return { x: v.x / length, y: v.y / length };
}

/** The unit vector from `from` toward `to`, or `null` when they coincide. */
export function direction(from: Vec, to: Vec): Vec | null {
  return unit({ x: to.x - from.x, y: to.y - from.y });
}

/** Two circles overlap when their centers are closer than their radii sum. */
export function circlesOverlap(
  a: Vec,
  ra: number,
  b: Vec,
  rb: number,
): boolean {
  return distance(a, b) < ra + rb;
}

/**
 * An axis-aligned rectangle centered at `center` and a circle overlap when
 * the circle's center is closer than its radius to the rectangle's nearest
 * point.
 */
export function rectCircleOverlap(
  center: Vec,
  width: number,
  height: number,
  circle: Vec,
  radius: number,
): boolean {
  const nearestX = Math.max(
    center.x - width / 2,
    Math.min(circle.x, center.x + width / 2),
  );
  const nearestY = Math.max(
    center.y - height / 2,
    Math.min(circle.y, center.y + height / 2),
  );
  return Math.hypot(circle.x - nearestX, circle.y - nearestY) < radius;
}

/** The unit vector at `degrees`, `0` along `+x`, turning toward `+y`. */
export function fromDegrees(degrees: number): Vec {
  const radians = (degrees * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

/** `v` turned by `degrees`, positive toward `+y`. */
export function rotate(v: Vec, degrees: number): Vec {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}
