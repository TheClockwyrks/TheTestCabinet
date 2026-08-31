// Floe (the strait) — the arrangements this group's checks share. CASE-PROVIDED.
//
// `validation/none/harness.ts` owns every compound sequence the whole suite
// uses, and `startCrossing` there is what every scenario below is built on. What
// it does not give, because no other group wants them, are the three
// arrangements this group's items are about:
//
//   - `MEASURED_TILES` and `poseOnMeasuredTile`, the eight spread tiles the
//     tile-to-stage map is read on. Two items read one scenario — what the game
//     REPORTS the critter's centre to be, and where it DRAWS it — so the eight
//     tiles are named once, here, and both read the same eight.
//   - `poseHopUpFromWater`, the one arrangement both row-`1` items need: the
//     critter standing at a column of row `2`, ready to hop up.
//   - `poseLiveLanes`, a level left exactly as the game laid it out and then run,
//     which is what `median-carries-nothing` reads and what `startCrossing`
//     deliberately clears away.
//
// None of them asserts a verdict and none carries a tolerance: a check states
// its own, beside the figure it is a tolerance on.

import {
  ICE_BOTTOM,
  ICE_TOP,
  ROW_BAYS,
  ROW_MEDIAN,
  ROW_NEAR,
  WATER_BOTTOM,
  WATER_ROWS,
  WATER_TOP,
  TILE,
  crossingTimer,
  tileLeft,
} from "../constants";
import { poseLane, type Harness } from "../harness";

/** One tile of the strait, as the two map items name it. */
export interface MeasuredTile {
  col: number;
  row: number;
  /** The band it is in, for the context a failure carries. */
  band: string;
}

/**
 * The eight tiles the tile-to-stage map is measured on.
 *
 * Spread on purpose, and spread in three ways at once, because the map is one
 * formula per axis and a build gets a formula wrong in a way that shows up at the
 * extremes rather than in the middle:
 *
 *   - ACROSS THE COLUMNS. Both extreme columns, `0` and `COLS - 1`, are here, so
 *     a build whose `tileCX` is off by half a tile or measured from the stage's
 *     centre is caught rather than flattered by a mid-strait reading.
 *   - DOWN THE ROWS. The bottom row and the bay row are both here, so a build
 *     that forgot `STRAIT_TOP` in `tileTop` — the one term that separates a stage
 *     `y` from a strait `y` — reads eighty units out at every one of them.
 *   - THROUGH THE FIVE BANDS. One tile in each of the near shore, the ice band,
 *     the median, the water band and the bay row, so no band is left unread.
 *
 * The bay-row tile is a column of the middle bay: `specs/strait.md` makes every
 * other column of row `1` solid far shore, and a critter is only ever on that row
 * inside a bay.
 */
export const MEASURED_TILES: readonly MeasuredTile[] = [
  { col: 0, row: ROW_NEAR, band: "the near shore, leftmost column" },
  { col: 39, row: ROW_NEAR, band: "the near shore, rightmost column" },
  { col: 7, row: ICE_BOTTOM, band: "the ice band, bottom row" },
  { col: 33, row: ICE_TOP, band: "the ice band, top row" },
  { col: 20, row: ROW_MEDIAN, band: "the median shelf" },
  { col: 3, row: WATER_BOTTOM, band: "the water band, bottom row" },
  { col: 36, row: WATER_TOP, band: "the water band, top row" },
  { col: 19, row: ROW_BAYS, band: "the bay row, inside the middle bay" },
];

/**
 * Put the critter on one of the measured tiles, and leave it able to sit there.
 *
 * `setCritterTile` alone would do for a reading taken without running a tick —
 * `tile-map` takes exactly that — but the drawn half of the same scenario has to
 * run a frame, and three of the eight tiles are in the WATER BAND, where a
 * critter whose footing is `water` falls in on that very tick
 * (`specs/water.md`). So a water-band tile gets the smallest floe the game has, a
 * one-tile `pan`, laid by `poseLane`, which stops the lane before it adds
 * anything: it covers exactly the tile the critter stands on and holds still.
 *
 * That floe is part of the requirement's own situation rather than a bystander
 * parked nearby — it is what makes the tile a tile a critter can be on — and it
 * is cleared away again before the next tile, so no floe from an earlier tile is
 * left on the strait.
 */
export async function poseOnMeasuredTile(
  h: Harness,
  tile: MeasuredTile,
): Promise<void> {
  await h.debug.clearFloes();
  if (WATER_ROWS.includes(tile.row)) {
    await poseLane(h, tile.row, "pan", [tile.col]);
  }
  await h.debug.setCritterTile(tile.col, tile.row);
}

/**
 * Stand the critter on a still floe at column `col` of row `2`, ready to hop up.
 *
 * The one arrangement both row-`1` items need. `specs/bays.md` makes a crossing
 * end on "a hop up from row `2`", and row `2` is the top row of the WATER BAND
 * (`specs/strait.md`), so the critter cannot simply be posed at the foot of the
 * far shore: it has to be standing on a floe there, and that floe is part of the
 * requirement's situation. It is a one-tile `pan` laid by `poseLane`, so it
 * covers exactly the tile the critter stands on and the lane holds still.
 *
 * The strait is otherwise emptied and every world gate shut by `startCrossing`,
 * so the hop that follows is decided by the far shore and by nothing else.
 */
export async function poseHopUpFromWater(
  h: Harness,
  col: number,
): Promise<void> {
  await poseLane(h, WATER_TOP, "pan", [col]);
  await h.debug.setCritterTile(col, WATER_TOP);
}

/**
 * Lay a level out, leave its sixteen lanes exactly as the game laid them, and
 * open a live crossing over them.
 *
 * The opposite of `startCrossing`, which empties the four rosters: here the
 * traffic is the requirement rather than a bystander, because what
 * `median-carries-nothing` is about is whether a lane's items ever reach the
 * median as they run and wrap.
 *
 * The four WORLD gates are shut all the same. They are the run's own faculties
 * rather than any entity's: without them a bear emerges behind the critter and
 * joins a scenario that never asked for one, the crossing timer drains for ten
 * seconds and takes a life at the end of it, and the bonus catch arrives in a bay
 * on its own cadence. Shutting them leaves the lanes running exactly as they run
 * in play, which is the whole of what is being read.
 *
 * `reset` first, then `setLevel`, because `setLevel` re-lays the sixteen lanes by
 * design (`specs/instrumentation.md`), and the critter last, on the tile the
 * caller named.
 */
export async function poseLiveLanes(
  h: Harness,
  col: number,
  row: number,
  level = 1,
): Promise<void> {
  const { debug } = h;
  await debug.reset();
  await debug.setLevel(level);
  await debug.setBearEmergence(false);
  await debug.setCatchTest(false);
  await debug.setFishCadence(false);
  await debug.setTimerRunning(false);
  await debug.setScreen("playing");
  await debug.setPhase("crossing");
  await debug.setPhaseTimer(0);
  await debug.setTimer(crossingTimer(level));
  await debug.addCritter(col, row);
}

/**
 * The centre `x` of a bay's mouth, in stage units.
 *
 * `specs/strait.md` makes every bay exactly two columns wide, and the pairs it
 * fixes are consecutive columns, so the mouth spans `2 * TILE` from the left
 * column's left edge and its centre is one whole tile in from there. A colour
 * sample taken at the seam between the two columns sits `TILE` from either end of
 * the mouth, which is as far from the solid shore on either side as a reading
 * inside the mouth can be.
 */
export function bayMouthX(columns: readonly [number, number]): number {
  return tileLeft(columns[0]) + TILE;
}
