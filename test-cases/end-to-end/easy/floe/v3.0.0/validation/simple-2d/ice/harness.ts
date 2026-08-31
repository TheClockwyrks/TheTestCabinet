// Floe (the ice band) — the two arrangements this group's checks share.
// CASE-PROVIDED.
//
// `validation/simple-2d/harness.ts` owns every compound sequence the whole suite
// uses, and `startCrossing` there is the one this group reaches for whenever a
// scenario poses a strait of its own. What it deliberately does NOT give is the
// opposite arrangement — a level left exactly as the game laid it out — because
// most of this group's items are about what LAYING OUT A LEVEL produces: the
// eight lanes, the vehicles filling them, the spacing between them, and the
// phases they were drawn at. For those the layout is not a bystander to be
// cleared away; it is the requirement.
//
// So the two things below are the ice band's own, and only the ice band's:
//
//   - `layOutLevel`, which resets, lays a level out and leaves one drawn frame
//     behind so a still has a picture, and hands back the snapshot taken BEFORE
//     that frame ran — the level as it was laid out, before a tick of lane
//     motion has moved anything.
//   - `midStraitVehicle`, which chooses the one vehicle of a row a check follows
//     when it means to measure the lane's own motion.
//
// Neither asserts a verdict and neither carries a tolerance: a check states its
// own, beside the figure it is a tolerance on.

import { STRAIT_W } from "../../src/constants";
import { fail } from "../assert";
import {
  itemsInRow,
  type FloeSnapshot,
  type Harness,
  type VehicleSnapshot,
} from "../harness";

/** What `layOutLevel` may vary beyond the level itself. */
export interface LayoutOptions {
  /** The seed all of the game's randomness runs off, `DEFAULT_SEED` by default. */
  seed?: number;
}

/**
 * Lay the strait out for a level and hand back the level exactly as it was laid.
 *
 * The sequence, and why each part of it is here:
 *
 *   - `reset(options)` puts every field back to its title-screen value and seeds
 *     the generator the lanes' phases are drawn from
 *     (specs/instrumentation.md), so what follows is a level laid out from a
 *     known start rather than whatever the previous reading left.
 *   - `setLevel(level)` re-lays the sixteen lanes for the level asked for. It is
 *     called even for level `1`, so every level this group reads arrives by the
 *     same route and a check at level `4` is not being compared against one that
 *     took a different one.
 *   - `setFishCadence(false)` shuts the one faculty that would otherwise act on
 *     its own while a check is reading: the bonus catch arrives in a bay every
 *     `FISH_INTERVAL` seconds and lingers, which is nothing to do with the ice
 *     band and everything to do with what the evidence shows. The other three
 *     world gates are left alone deliberately — `reset` leaves no critter on the
 *     strait, so no bear can emerge, nothing can be caught, and no crossing is
 *     under way for the timer to end.
 *   - `setScreen("playing")` because the strait is drawn on the `playing` screen
 *     and a still taken on the title screen would show a menu.
 *
 * THE SNAPSHOT IS TAKEN BEFORE THE FRAME RUNS. A drawn frame costs a tick, and a
 * tick of lane motion moves every vehicle a fraction of a unit — harmless to a
 * row or a kind, but `phases-staggered` reads a property of the phases the level
 * was LAID OUT at, so the reading is taken at that moment and the frame runs
 * after it.
 */
export async function layOutLevel(
  h: Harness,
  level = 1,
  options: LayoutOptions = {},
): Promise<FloeSnapshot> {
  if (options.seed === undefined) h.debug.reset();
  else h.debug.reset({ seed: options.seed });
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
 * The vehicle on a row whose left edge sits nearest the middle of the strait.
 *
 * The one a check follows when it means to measure a lane's own motion over a
 * stretch of game time. A lane's items wrap — "a vehicle carried off one edge
 * returns at the other" (specs/ice.md) — and a wrap is a jump rather than
 * travel, so a displacement measured across one says nothing about the lane's
 * rate or its direction. The middle of the strait is `STRAIT_W / 2` (`640`)
 * units from either edge, and the fastest ice lane covers `2.5 * TILE` (`80`)
 * units in a second, so a vehicle picked here cannot reach an edge inside the
 * second a check measures and cannot be the one that jumps.
 *
 * It is a CHOICE OF WHICH VEHICLE TO WATCH and nothing more: no threshold rests
 * on it, and every vehicle in the lane moves together.
 *
 * A row carrying nothing at all fails here rather than handing a check an absent
 * value to reason about: specs/ice.md requires that "a lane always carries
 * enough vehicles to reach both edges of the strait".
 */
export function midStraitVehicle(
  snapshot: FloeSnapshot,
  row: number,
): VehicleSnapshot {
  const carried = itemsInRow(snapshot.vehicles, row);
  if (carried.length === 0) {
    fail(
      `at least one vehicle on ice row ${row}: a lane always carries enough ` +
        "vehicles to reach both edges of the strait (specs/ice.md)",
      "no vehicle on that row",
    );
  }
  const middle = STRAIT_W / 2;
  let nearest = carried[0];
  for (const vehicle of carried) {
    if (Math.abs(vehicle.x - middle) < Math.abs(nearest.x - middle)) {
      nearest = vehicle;
    }
  }
  return nearest;
}
