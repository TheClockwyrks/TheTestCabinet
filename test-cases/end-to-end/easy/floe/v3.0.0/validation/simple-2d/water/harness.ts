// Floe (the water band) — the two arrangements this group's checks share.
// CASE-PROVIDED.
//
// `validation/simple-2d/harness.ts` owns every compound sequence the whole suite
// uses, and `startCrossing` there is the one this group reaches for whenever a
// scenario poses a strait of its own — the drowning, the riding, the carry and
// the two sweeps each pose an empty strait and put exactly one floe and one
// critter on it.
//
// What that shared harness deliberately does NOT give is the opposite
// arrangement — a level left exactly as the game laid it out — because half of
// this group's items are about what LAYING OUT A LEVEL produces: the eight
// lanes, the floes filling them, the open water between them, and the phases
// they were drawn at. For those the layout is not a bystander to be cleared
// away; it is the requirement.
//
// So the two things below are the water band's own, and only the water band's:
//
//   - `layOutLevel`, which resets, lays a level out and leaves one drawn frame
//     behind so a still has a picture, and hands back the snapshot taken BEFORE
//     that frame ran — the level as it was laid out, before a tick of lane
//     motion has moved anything.
//   - `midStraitFloe`, which chooses the one floe of a row a check follows when
//     it means to measure the lane's own motion.
//
// Neither asserts a verdict and neither carries a tolerance: a check states its
// own, beside the figure it is a tolerance on.

import { STRAIT_W } from "../constants";
import { fail } from "../assert";
import {
  itemsInRow,
  type FloeItemSnapshot,
  type FloeSnapshot,
  type Harness,
} from "../harness";

/**
 * Lay the strait out for a level and hand back the level exactly as it was laid.
 *
 * The sequence, and why each part of it is here:
 *
 *   - `reset()` puts every field back to its title-screen value
 *     (specs/instrumentation.md), so what follows is a level laid out from a
 *     known start rather than whatever the previous reading left.
 *   - `setLevel(level)` re-lays the sixteen lanes for the level asked for. It is
 *     called even for level `1`, so every level this group reads arrives by the
 *     same route and a check at level `4` is not being compared against one that
 *     took a different one.
 *   - `setFishCadence(false)` shuts the one faculty that would otherwise act on
 *     its own while a check is reading: the bonus catch arrives in a bay every
 *     `FISH_INTERVAL` seconds and lingers, which is nothing to do with the water
 *     band and everything to do with what the evidence shows. The other three
 *     world gates are left alone deliberately — `reset` leaves no critter on the
 *     strait, so no bear can emerge, nothing can be caught, and no crossing is
 *     under way for the timer to end.
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
  h.debug.reset();
  h.debug.setLevel(level);
  h.debug.setFishCadence(false);
  h.debug.setScreen("playing");
  const laid = h.snapshot();
  // One drawn frame, so `captureStill` has a picture of the level to keep even
  // when the assertions below it fail.
  await h.advance(1);
  return laid;
}

/**
 * Lay the strait out for `level` once more, on a fresh draw of the sixteen
 * phases, and hand back the level exactly as it was laid.
 *
 * `setLevel` re-lays every lane (specs/instrumentation.md), and where each
 * lane's pattern sits is drawn when a level is laid out, so each call is one
 * more draw of the band. Nothing else is touched, and no frame runs.
 */
export function relayLevel(h: Harness, level = 1): FloeSnapshot {
  h.debug.setLevel(level);
  return h.snapshot();
}

/**
 * The floe on a row whose left edge sits nearest the middle of the strait.
 *
 * The one a check follows when it means to measure a lane's own motion over a
 * stretch of game time. A lane's items wrap — "a floe carried off one edge
 * returns at the other" (specs/water.md) — and a wrap is a jump rather than
 * travel, so a displacement measured across one says nothing about the lane's
 * rate or its direction. The middle of the strait is `STRAIT_W / 2` (`640`)
 * units from either edge, and the fastest water lane covers `4.2 * TILE`
 * (`134.4`) units in a second, so a floe picked here cannot reach an edge inside
 * the second a check measures and cannot be the one that jumps.
 *
 * It is a CHOICE OF WHICH FLOE TO WATCH and nothing more: no threshold rests on
 * it, and every floe in the lane moves together.
 *
 * A row carrying nothing at all fails here rather than handing a check an absent
 * value to reason about: specs/water.md requires that "a lane always carries
 * enough floes to reach both edges of the strait".
 */
export function midStraitFloe(
  snapshot: FloeSnapshot,
  row: number,
): FloeItemSnapshot {
  const carried = itemsInRow(snapshot.floes, row);
  if (carried.length === 0) {
    fail(
      `at least one floe on water row ${row}: a lane always carries enough ` +
        "floes to reach both edges of the strait (specs/water.md)",
      "no floe on that row",
    );
  }
  const middle = STRAIT_W / 2;
  let nearest = carried[0];
  for (const floe of carried) {
    if (Math.abs(floe.x - middle) < Math.abs(nearest.x - middle)) {
      nearest = floe;
    }
  }
  return nearest;
}
