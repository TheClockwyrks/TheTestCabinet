// Floe (the water band) — the arrangements this group's checks share.
// CASE-PROVIDED.
//
// `validation/none/harness.ts` owns every compound sequence the whole suite
// uses, and `startCrossing` there is the one this group reaches for whenever a
// check poses a strait of its own — the drowning, the riding, the carry and the
// two sweeps all pose an empty strait and put exactly one floe and one critter
// on it.
//
// What that shared harness deliberately does NOT give is the opposite
// arrangement — a level left exactly as the game laid it out — because half of
// this group's items are about what LAYING OUT A LEVEL produces: the eight
// lanes, the floes filling them, the open water between them, and the phases
// they were drawn at. For those the layout is not a bystander to be cleared
// away; it is the requirement.
//
// So the four things below are the water band's own:
//
//   - `layOutLevel`, which resets, lays a level out and leaves one drawn frame
//     behind so a still has a picture, and hands back the snapshot taken BEFORE
//     that frame ran — the level as it was laid out, before a tick of lane
//     motion has moved anything.
//   - `floesAlong`, the floes of one row in order along it.
//   - `openWaterRuns`, which reads the open water `specs/water.md` measures: the
//     distance from one floe's right edge to the next floe's left edge, taken
//     between consecutive floes along the row.
//   - `midStraitFloe`, the floe a check follows when it means to measure a
//     lane's own motion over a stretch of game time.
//
// None of them asserts a verdict and none of them carries a tolerance: a check
// states its own, beside the figure it is a tolerance on.

import { STRAIT_W, TILE } from "../constants";
import type { FloeSnapshot, Harness, ItemView } from "../harness";

/**
 * Lay the strait out for a level and hand back the level exactly as it was laid.
 *
 * The sequence, and why each part of it is here:
 *
 *   - `reset()` puts every field back to its title-screen value
 *     (specs/instrumentation.md), so what follows is a level laid out from a
 *     known start rather than whatever the previous check left.
 *   - `setLevel(level)` re-lays the sixteen lanes for the level asked for. It is
 *     called even for level `1`, so every level this group reads arrives by the
 *     same route and a check at level `4` is not being compared against one that
 *     took a different one.
 *   - `setFishCadence(false)` shuts the one faculty that would otherwise act on
 *     its own while a check is reading: the bonus catch arrives in a bay every
 *     eight seconds and lingers, which is nothing to do with the water band and
 *     everything to do with what the evidence shows. The other three world gates
 *     are left alone deliberately — `reset` leaves no critter on the strait, so
 *     no bear can emerge, nothing can be caught, and the crossing timer does not
 *     drain.
 *   - `setScreen("playing")` because the strait is drawn on the `playing` screen
 *     and a still taken on the title screen would show a menu.
 *
 * THE SNAPSHOT IS TAKEN BEFORE THE FRAME RUNS. A drawn frame costs a tick, and a
 * tick of lane motion moves every floe a fraction of a unit — harmless to a row
 * or a kind, but `phases-staggered` reads a property of the phases the level was
 * LAID OUT at, so the reading is taken at that moment and the frame runs after
 * it.
 */
export async function layOutLevel(
  h: Harness,
  level = 1,
): Promise<FloeSnapshot> {
  const { debug } = h;
  await debug.reset();
  await debug.setLevel(level);
  await debug.setFishCadence(false);
  await debug.setScreen("playing");
  const laid = await h.snapshot();
  // One drawn frame, so `captureStill` has a picture of the level to keep even
  // when the assertions below it fail.
  await h.step(1);
  return laid;
}

/** Every floe on a water row, ordered along the row by its left edge. */
export function floesAlong(snapshot: FloeSnapshot, row: number): ItemView[] {
  return snapshot.floes
    .filter((floe) => floe.row === row)
    .sort((a, b) => a.x - b.x);
}

/**
 * The runs of open water between consecutive floes on a row, in stage units.
 *
 * `specs/water.md` measures a lane's gap as the open water "between one floe's
 * right edge and the next floe's left edge", so each run here is
 * `next.x - (floe.x + TILE * floe.len)` over the floes taken in order along the
 * row. A lane carrying fewer than two floes has no such run and yields none.
 *
 * THE SPAN IS THE ONE THE BUILD REPORTS, `floe.len`, rather than the table's
 * figure for the kind: `water/lane-lengths` is the item that grades a span, and
 * a run of open water read here is the water between the floes as this build has
 * them.
 *
 * Only CONSECUTIVE pairs are measured, which is what leaves the wrap out of it:
 * the distance from the row's rightmost floe back round to its leftmost is not a
 * run of open water on the strait, and a lane whose ring reaches past both edges
 * would report it as an enormous one.
 */
export function openWaterRuns(snapshot: FloeSnapshot, row: number): number[] {
  const ordered = floesAlong(snapshot, row);
  const runs: number[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const left = ordered[i - 1];
    runs.push(ordered[i].x - (left.x + TILE * left.len));
  }
  return runs;
}

/**
 * The floe on a row whose left edge sits nearest the middle of the strait.
 *
 * The one a check follows when it means to measure a lane's own motion over a
 * stretch of game time. A lane's floes wrap — "a floe carried off one edge
 * returns at the other" (`specs/water.md`) — and a wrap is a jump rather than
 * travel, so a displacement measured across one says nothing about the lane's
 * rate or its direction. The middle of the strait is `STRAIT_W / 2` (`640`)
 * units from either edge, and the fastest water lane covers `4.2 * TILE`
 * (`134.4`) units in a second, so a floe picked here cannot reach an edge inside
 * the second a check measures and cannot be the one that jumps.
 *
 * It is a CHOICE OF WHICH FLOE TO WATCH and nothing more: no threshold rests on
 * it, and every floe in the lane moves together.
 */
export function midStraitFloe(
  snapshot: FloeSnapshot,
  row: number,
): ItemView | undefined {
  const middle = STRAIT_W / 2;
  let nearest: ItemView | undefined;
  for (const floe of floesAlong(snapshot, row)) {
    if (
      nearest === undefined ||
      Math.abs(floe.x - middle) < Math.abs(nearest.x - middle)
    ) {
      nearest = floe;
    }
  }
  return nearest;
}
