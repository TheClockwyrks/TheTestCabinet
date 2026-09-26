// Spectra — the stage's geometry, and the starfield behind it.
//
// `specs/field.md` fixes the three regions, the ship's lane, the formation grid and
// its sway, and where a bullet crosses an edge. `src/constants.ts` names those
// figures; this file is the handful of reads over them the rest of the build wants,
// plus the one thing the specification asks for but leaves entirely to the build:
// the starfield's layout.
//
// THE STARFIELD IS NOT PART OF THE SIMULATION. It is laid out once, from a fixed
// sequence of its own, so the same sky is drawn on every load and no draw the game
// makes in play moves it. Its marks are static: `specs/field.md` leaves motion optional and a still
// field keeps the drones the only moving thing a player has to read.

import {
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  SHIP_X_MAX,
  SHIP_X_MIN,
  STARFIELD_MIN,
  swayOffset,
} from "./constants";

/** The ship's centre `x`, clamped to its lane. */
export function clampShipX(x: number): number {
  return Math.max(SHIP_X_MIN, Math.min(SHIP_X_MAX, x));
}

/** The centre of the ship's lane, which a respawn returns it to. */
export const LANE_CENTER = (SHIP_X_MIN + SHIP_X_MAX) / 2;

/** Whether a centre lies inside the play field on both axes. */
export function inPlayField(x: number, y: number): boolean {
  return (
    x >= FIELD_LEFT && x <= FIELD_RIGHT && y >= FIELD_TOP && y <= FIELD_BOTTOM
  );
}

/** Where a drone resting in its slot sits at `t` seconds into the wave. */
export function slotPosition(
  slotCentreX: number,
  slotCentreY: number,
  t: number,
): { x: number; y: number } {
  return { x: slotCentreX + swayOffset(t), y: slotCentreY };
}

/** One mark of the starfield. */
export interface Star {
  x: number;
  y: number;
  /** The mark's radius, in logical units. */
  r: number;
  /** How brightly the mark is drawn, in `[0, 1]`. */
  alpha: number;
}

/** How many marks the starfield holds; comfortably above the stated floor. */
export const STARFIELD_COUNT = STARFIELD_MIN * 3;

/**
 * The starfield's marks, laid out once.
 *
 * The sequence is a local one started from a fixed value: the layout is the same
 * every load, so two captures of the same posed field are identical.
 */
export const STARFIELD: readonly Star[] = layOutStarfield();

function layOutStarfield(): Star[] {
  let word = 0x5be1a7;
  const next = (): number => {
    word = (word + 0x6d2b79f5) >>> 0;
    let t = word;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const stars: Star[] = [];
  for (let index = 0; index < STARFIELD_COUNT; index += 1) {
    stars.push({
      x: FIELD_LEFT + next() * (FIELD_RIGHT - FIELD_LEFT),
      y: FIELD_TOP + next() * (FIELD_BOTTOM - FIELD_TOP),
      r: 0.7 + next() * 1.3,
      alpha: 0.25 + next() * 0.5,
    });
  }
  return stars;
}
