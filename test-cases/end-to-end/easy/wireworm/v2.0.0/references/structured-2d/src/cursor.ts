// Wireworm — the cursor: how it moves inside the band, how it fires, and what
// reaching it costs (`specs/cursor.md`).
//
// The cursor is the one part of the game the player drives directly, so its
// movement and its firing are resolved from the frame's input in the player
// controller (`src/controller.ts`) rather than in the mode's tick. What is here
// is the arithmetic both that path and the debug surface's `setCursor` run
// through, so a posed cursor lands exactly where a played one would.
//
// The diagonal is normalized: two perpendicular movements held together move the
// cursor along the diagonal at `CURSOR_SPEED`, so each axis contributes
// `CURSOR_SPEED / sqrt(2)` rather than the full rate. That is the difference
// between a cursor that crosses the board faster diagonally and one that does
// not.

import {
  CURSOR_HALF,
  CURSOR_SPEED,
  CURSOR_X_MAX,
  CURSOR_X_MIN,
  CURSOR_Y_MAX,
  CURSOR_Y_MIN,
  FIRE_INTERVAL,
  FOE_HALF,
  MAX_BOLTS,
  TILE,
  tileLeft,
  tileTop,
} from "./constants";
import type { FrameCues } from "./audio";
import { addBoltTo } from "./bolts";
import type { WirewormState } from "./game";

/** What the frame's input asked the cursor to do. */
export interface CursorIntent {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  fire: boolean;
}

/** A stage position clamped to the player band's four bounds. */
export function clampToBand(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(CURSOR_X_MAX, Math.max(CURSOR_X_MIN, x)),
    y: Math.min(CURSOR_Y_MAX, Math.max(CURSOR_Y_MIN, y)),
  };
}

/** Place the cursor's center, with the band's clamp applied. */
export function placeCursor(state: WirewormState, x: number, y: number): void {
  const at = clampToBand(x, y);
  state.cursor.x = at.x;
  state.cursor.y = at.y;
}

/**
 * Resolve one frame of input into the cursor: the movement held this frame, and
 * the bolt a held fire action produces while the cooldown and the cap allow one.
 */
export function resolveCursorIntent(
  state: WirewormState,
  dt: number,
  intent: CursorIntent,
  cues: FrameCues,
): void {
  const ax = (intent.right ? 1 : 0) - (intent.left ? 1 : 0);
  const ay = (intent.down ? 1 : 0) - (intent.up ? 1 : 0);
  if (ax !== 0 || ay !== 0) {
    const length = Math.hypot(ax, ay);
    const step = (CURSOR_SPEED * dt) / length;
    placeCursor(state, state.cursor.x + ax * step, state.cursor.y + ay * step);
  }

  if (!intent.fire) return;
  if (state.fireCooldown > 0) return;
  if (state.bolts.length >= MAX_BOLTS) return;
  addBoltTo(state, state.cursor.x, state.cursor.y - CURSOR_HALF);
  state.fireCooldown = FIRE_INTERVAL;
  cues.fire = true;
}

/** Whether two axis-aligned boxes, given by their extents, overlap. */
function overlaps(
  aMinX: number,
  aMaxX: number,
  aMinY: number,
  aMaxY: number,
  bMinX: number,
  bMaxX: number,
  bMinY: number,
  bMaxY: number,
): boolean {
  return aMinX < bMaxX && bMinX < aMaxX && aMinY < bMaxY && bMinY < aMaxY;
}

/**
 * Whether a worm segment or a foe is reaching the cursor this instant. The
 * cursor's box is `CURSOR_HALF` from its center on each axis, a foe's is
 * `FOE_HALF` from its own, and a segment's is the tile it occupies.
 */
export function cursorTouched(state: WirewormState): boolean {
  const { x, y } = state.cursor;
  const minX = x - CURSOR_HALF;
  const maxX = x + CURSOR_HALF;
  const minY = y - CURSOR_HALF;
  const maxY = y + CURSOR_HALF;

  for (const worm of state.worms) {
    for (const segment of worm.segments) {
      const left = tileLeft(segment.c);
      const top = tileTop(segment.r);
      if (
        overlaps(minX, maxX, minY, maxY, left, left + TILE, top, top + TILE)
      ) {
        return true;
      }
    }
  }

  for (const foe of state.foes) {
    if (
      overlaps(
        minX,
        maxX,
        minY,
        maxY,
        foe.x - FOE_HALF,
        foe.x + FOE_HALF,
        foe.y - FOE_HALF,
        foe.y + FOE_HALF,
      )
    ) {
      return true;
    }
  }

  return false;
}
