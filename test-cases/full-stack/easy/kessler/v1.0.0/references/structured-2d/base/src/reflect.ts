// Kessler — the deflector bounce and the reflection pipeline
// (specs/deflector-and-ball.md).
//
// Two entry points. `paddleBounce` is the deflector's four steps — specular,
// english, clamp, speed — and it alone sets the ball to the wave's ball speed.
// `surfaceReflect` is the pipeline every other surface resolves through:
// specular by surface type, the moving-ring kick where one applies,
// renormalization to the arriving speed, and the orbital decay toward the
// nearer radial. Every function here maps an incoming velocity to an outgoing
// one and touches nothing else; reflecting in place is the caller's rule.

import {
  BOUNCE_CLAMP_DEG,
  ENGLISH_DEG_PER_OFFSET_DEG,
  ORBITAL_DECAY_DEG,
  RING_KICK_FACTOR,
} from "./constants";
import {
  dot,
  lengthOf,
  rotateDeg,
  scaledTo,
  signedAngleDeg,
  tangentialOf,
  type Vec,
} from "./polar";

/** A face contact: reflects the radial component, `v' = v - 2 (v . n) n`. */
export function reflectFace(v: Vec, n: Vec): Vec {
  const d = 2 * dot(v, n);
  return { x: v.x - d * n.x, y: v.y - d * n.y };
}

/** An edge contact: reflects the tangential component, `v' = v - 2 (v . t) t`. */
export function reflectEdge(v: Vec, n: Vec): Vec {
  const t = tangentialOf(n);
  const d = 2 * dot(v, t);
  return { x: v.x - d * t.x, y: v.y - d * t.y };
}

/**
 * The orbital decay: rotates `v` toward the local radial axis by
 * `min(6, |phi|)` degrees, where `phi` is the signed angle from the nearer
 * radial direction — outward `n` or inward `-n` — to `v`. The rotation reduces
 * `|phi|`.
 */
export function orbitalDecay(v: Vec, n: Vec): Vec {
  const fromOutward = signedAngleDeg(n, v);
  const fromInward = signedAngleDeg({ x: -n.x, y: -n.y }, v);
  const phi =
    Math.abs(fromOutward) <= Math.abs(fromInward) ? fromOutward : fromInward;
  if (phi === 0) return v;
  const step = Math.min(ORBITAL_DECAY_DEG, Math.abs(phi));
  return rotateDeg(v, phi > 0 ? -step : step);
}

/**
 * The deflector bounce's four steps, in order: specular off the radial,
 * english of `1.2 * offsetDeg` degrees, the clamp of the outgoing angle to
 * `[-60, +60]` degrees off the outward radial with its sign preserved, and the
 * speed set to `outSpeed`, the current wave's ball speed.
 *
 * `n` is the outward unit radial at the ball's center and `offsetDeg` the
 * signed wrap-aware angular offset of the ball's center from the deflector's
 * center angle, positive toward `+theta`.
 */
export function paddleBounce(
  v: Vec,
  n: Vec,
  offsetDeg: number,
  outSpeed: number,
): Vec {
  const specular = reflectFace(v, n);
  const spun = rotateDeg(specular, ENGLISH_DEG_PER_OFFSET_DEG * offsetDeg);
  const angle = signedAngleDeg(n, spun);
  const clamped = Math.max(
    -BOUNCE_CLAMP_DEG,
    Math.min(BOUNCE_CLAMP_DEG, angle),
  );
  const direction = rotateDeg(n, clamped);
  return { x: direction.x * outSpeed, y: direction.y * outSpeed };
}

/**
 * The reflection pipeline for every non-deflector surface: specular by surface
 * type, the ring kick of `0.5 * u` for a contact with a target in a moving
 * ring, renormalization to the speed the ball arrived with, and the orbital
 * decay.
 *
 * `n` is the outward unit radial at the ball's center. `ringSurfaceVelocity`
 * is the moving ring's surface velocity `u` at the ball — tangential in the
 * ring's direction of motion with magnitude `|omega| * r` — or `null` where no
 * kick applies (a stationary ring, the shield, the containment field).
 */
export function surfaceReflect(
  v: Vec,
  contact: "face" | "edge",
  n: Vec,
  ringSurfaceVelocity: Vec | null,
): Vec {
  const arrivedSpeed = lengthOf(v);
  let out = contact === "face" ? reflectFace(v, n) : reflectEdge(v, n);
  if (ringSurfaceVelocity) {
    out = {
      x: out.x + RING_KICK_FACTOR * ringSurfaceVelocity.x,
      y: out.y + RING_KICK_FACTOR * ringSurfaceVelocity.y,
    };
  }
  out = scaledTo(out, arrivedSpeed);
  return orbitalDecay(out, n);
}
