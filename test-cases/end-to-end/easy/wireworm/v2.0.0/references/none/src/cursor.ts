// Wireworm — the cursor: where it may go, when it fires, and what reaching it
// costs (specs/cursor.md).
//
// The cursor moves freely inside the player band, never snapping to tiles, and
// its center is clamped to the band's four bounds — so a movement held against a
// bound leaves it resting exactly on that bound. Two perpendicular movements
// held together travel the diagonal at the SAME rate, which is why the axis pair
// is normalized before it is scaled: an unnormalized diagonal would be `sqrt(2)`
// times faster than either axis alone.
//
// The contact test is the cursor's, and so is its gate. Turning `contact` off
// leaves the cursor drawing, moving and firing exactly as it does in play and
// stops only the life a segment or a foe reaching it would cost — which is what
// lets a scenario about the worm, or about a foe, run inside the band without
// being derailed by an incidental respawn.

import {
  CURSOR_HALF,
  CURSOR_X_MAX,
  CURSOR_X_MIN,
  CURSOR_Y_MAX,
  CURSOR_Y_MIN,
  CURSOR_SPEED,
  CUES,
  FIRE_INTERVAL,
  FOE_HALF,
  MAX_BOLTS,
  TILE,
  tileLeft,
  tileTop,
} from "./constants";
import { loseLife } from "./progression";
import type { Cursor, CueSink, WirewormState } from "./types";

/** Hold the cursor's center inside the player band, on every bound. */
export function clampCursor(cursor: Cursor): void {
  cursor.x = Math.max(CURSOR_X_MIN, Math.min(CURSOR_X_MAX, cursor.x));
  cursor.y = Math.max(CURSOR_Y_MIN, Math.min(CURSOR_Y_MAX, cursor.y));
}

/** The axis pair a frame's held movement actions add up to, each `-1`, `0` or `+1`. */
export interface MoveAxis {
  x: number;
  y: number;
}

/** Travel for one frame at `CURSOR_SPEED`, along the diagonal if both axes are held. */
export function moveCursor(
  state: WirewormState,
  axis: MoveAxis,
  dt: number,
): void {
  if (axis.x !== 0 || axis.y !== 0) {
    const length = Math.hypot(axis.x, axis.y);
    state.cursor.x += (axis.x / length) * CURSOR_SPEED * dt;
    state.cursor.y += (axis.y / length) * CURSOR_SPEED * dt;
  }
  clampCursor(state.cursor);
}

/**
 * Count the fire cooldown down and, while the fire action is held, put a bolt in
 * the air whenever the cooldown is at rest and fewer than `MAX_BOLTS` are in
 * flight.
 *
 * A bolt is created in the cursor's column, `CURSOR_HALF` above its center, and
 * is deliberately not moved on the frame it appeared: the muzzle a check reads
 * is where the bolt was created rather than a fraction of a frame up the board.
 */
export function updateFiring(
  state: WirewormState,
  firing: boolean,
  dt: number,
  cues: CueSink,
): void {
  state.fireCooldown = Math.max(0, state.fireCooldown - dt);
  if (!firing) return;
  if (state.fireCooldown > 0 || state.bolts.length >= MAX_BOLTS) return;
  state.bolts.push({
    id: state.nextId,
    x: state.cursor.x,
    y: state.cursor.y - CURSOR_HALF,
  });
  state.nextId += 1;
  state.fireCooldown = FIRE_INTERVAL;
  cues.play(CUES.fire);
}

/** Whether two axis-aligned boxes overlap. */
function overlaps(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * A worm segment or a foe reaching the cursor costs a life.
 *
 * The gate and the spawn-in invulnerability are both checked here, so a build
 * with either running plays on through whatever it is standing in.
 */
export function checkContact(state: WirewormState, cues: CueSink): void {
  const cursor = state.cursor;
  if (!cursor.contact || cursor.invulnerable > 0) return;
  const x = cursor.x - CURSOR_HALF;
  const y = cursor.y - CURSOR_HALF;
  const size = CURSOR_HALF * 2;

  for (const worm of state.worms) {
    for (const segment of worm.segments) {
      if (
        overlaps(
          x,
          y,
          size,
          size,
          tileLeft(segment.c),
          tileTop(segment.r),
          TILE,
          TILE,
        )
      ) {
        loseLife(state, cues);
        return;
      }
    }
  }

  for (const foe of state.foes) {
    if (
      overlaps(
        x,
        y,
        size,
        size,
        foe.x - FOE_HALF,
        foe.y - FOE_HALF,
        FOE_HALF * 2,
        FOE_HALF * 2,
      )
    ) {
      loseLife(state, cues);
      return;
    }
  }
}
