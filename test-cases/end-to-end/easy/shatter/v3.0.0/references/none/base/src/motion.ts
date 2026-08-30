// Shatter — the three things that happen to a body every tick.
//
// `specs/simulation.md` fixes the order inside one tick: control forces, then the
// star's pull, then velocity, then position, then the wrap, then collision. This
// file holds the middle of that — the pull applied to a velocity, the travel that
// follows, and the one non-lethal push the field does to a body — so each system
// spells its own tick out in those terms rather than re-deriving them.
//
// Nothing here decides WHICH bodies are pulled. `specs/gravity.md` does, and the
// systems that own the bodies obey it: bullets, saucer bullets and rocks call
// {@link pull}; the ship, the saucer and the torpedo never do, because each is a
// powered craft the well never touches.

import { CORE_R, STAR_X, STAR_Y } from "./constants";
import { gravity, wrapPoint } from "./geometry";

/** Anything with a centre and a velocity: every body on the field is one. */
export interface Moving {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Add the star's pull over `dt` to a ballistic body's velocity. */
export function pull(body: Moving, dt: number): void {
  const a = gravity(body.x, body.y);
  body.vx += a.x * dt;
  body.vy += a.y * dt;
}

/** Advance a body by its velocity over `dt`, and bring it back into the field. */
export function travel(body: Moving, dt: number): void {
  body.x += body.vx * dt;
  body.y += body.vy * dt;
  wrapPoint(body);
}

/**
 * Push a body out of the star's solid core and take away the part of its
 * velocity that was heading into it, keeping the part along the surface.
 *
 * This is the slide `specs/collision.md` fixes for the ship: the core is solid
 * but never lethal, so a ship that reaches it grazes around the surface and slides
 * free with its facing and the player's control untouched. The saucer's steering
 * uses the same push as the floor under its own avoidance.
 *
 * The direct vector is used rather than a wrapped one: the core is a single point
 * at the middle of the field, nowhere near a seam.
 */
export function slideOffCore(body: Moving, radius: number): void {
  const dx = body.x - STAR_X;
  const dy = body.y - STAR_Y;
  const distance = Math.hypot(dx, dy);
  const clearance = CORE_R + radius;
  if (distance >= clearance || distance === 0) return;
  const nx = dx / distance;
  const ny = dy / distance;
  body.x = STAR_X + nx * clearance;
  body.y = STAR_Y + ny * clearance;
  const inward = body.vx * nx + body.vy * ny;
  if (inward < 0) {
    body.vx -= inward * nx;
    body.vy -= inward * ny;
  }
}
