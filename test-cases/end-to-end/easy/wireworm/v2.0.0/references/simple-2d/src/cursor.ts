// Wireworm — the cursor: how it moves inside its band and what reaching it costs
// (`specs/cursor.md`).
//
// The cursor is the one entity a scenario cannot take off the board, so its
// contact test carries its own gate: with `cursor.contact` off it still draws,
// still moves and still fires, and nothing that touches it costs anything.

import {
  CURSOR_HALF,
  CURSOR_SPEED,
  CURSOR_X_MAX,
  CURSOR_X_MIN,
  CURSOR_Y_MAX,
  CURSOR_Y_MIN,
  FOE_HALF,
  TILE,
  tileLeft,
  tileTop,
} from "./constants";
import type { Sim } from "./sim";

/** A position held inside the player band's four bounds. */
export function clampCursor(
  x: number,
  y: number,
): { readonly x: number; readonly y: number } {
  return {
    x: Math.max(CURSOR_X_MIN, Math.min(CURSOR_X_MAX, x)),
    y: Math.max(CURSOR_Y_MIN, Math.min(CURSOR_Y_MAX, y)),
  };
}

/**
 * Slide the cursor for one frame.
 *
 * The rate is the same in every direction, so two perpendicular movements held
 * together travel the diagonal at `CURSOR_SPEED` and each axis contributes
 * `CURSOR_SPEED / sqrt(2)`. Opposite movements cancel before this is reached,
 * because each axis arrives as `right - left` and `down - up`.
 */
export function moveCursor(sim: Sim, mx: number, my: number, dt: number): void {
  const length = Math.hypot(mx, my);
  if (length > 0) {
    const vx = (mx / length) * CURSOR_SPEED;
    const vy = (my / length) * CURSOR_SPEED;
    const held = clampCursor(sim.cursor.x + vx * dt, sim.cursor.y + vy * dt);
    sim.cursor.x = held.x;
    sim.cursor.y = held.y;
  }
}

/** Whether two axis-aligned boxes, given by center and half-extent, overlap. */
function boxesOverlap(
  ax: number,
  ay: number,
  ahalf: number,
  bx: number,
  by: number,
  bhalf: number,
): boolean {
  return (
    Math.abs(ax - bx) <= ahalf + bhalf && Math.abs(ay - by) <= ahalf + bhalf
  );
}

/**
 * Whether a worm segment or a foe is reaching the cursor right now.
 *
 * A foe reaches it when the two boxes overlap; a segment reaches it when its
 * tile overlaps the cursor's box.
 */
export function cursorTouched(sim: Sim): boolean {
  const { x, y } = sim.cursor;

  for (const foe of sim.foes) {
    if (boxesOverlap(x, y, CURSOR_HALF, foe.x, foe.y, FOE_HALF)) return true;
  }

  for (const worm of sim.worms) {
    for (const tile of worm.segments) {
      const left = tileLeft(tile.c);
      const top = tileTop(tile.r);
      if (
        x + CURSOR_HALF >= left &&
        x - CURSOR_HALF <= left + TILE &&
        y + CURSOR_HALF >= top &&
        y - CURSOR_HALF <= top + TILE
      ) {
        return true;
      }
    }
  }

  return false;
}
