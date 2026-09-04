// Wick — evolutions/blaze-scatter: Blaze's puddles land at random points of
// the disk of radius `OIL_SCATTER` about the lamplighter.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Blaze"): "on each firing, `amount` puddles
//     appear, each centered at an independent uniformly random point of the
//     disk of radius `OIL_SCATTER` (`400`) about the player's center".
//   - `specs/weapons.md` ("Derived stats"): "`OIL_SCATTER`, `SPARK_RANGE`,
//     `PIN_SPREAD`, the spread angles, and the re-hit intervals are unchanged
//     by any passive."
//   - `specs/world.md` ("One tick"), phase 5: a due weapon fires "creating its
//     projectiles and zones at the lamplighter's ... positions of this tick".
//   - `specs/state.md` (`ZoneState`): "`x`, `y`: the center of the circle".
//   - `specs/instrumentation.md` (`setWeaponCooldown`): "`setWeaponCooldown(slot,
//     0)` makes that the next tick"; (`clearZones`): "Removes every zone".
//
// WHAT IS READ. Ten firings, each made due by posing the timer to `0` and
// running one tick. For every puddle a firing tick created, the distance from
// its center to the lamplighter's center on that tick is at most 400; and
// across the fifty landing points, more than one distinct point appears. A
// build scattering over a larger disk, or about a point other than the
// lamplighter, puts a puddle beyond the bound within a few firings, and one
// that drops every puddle on a fixed point fails the second reading.
//
// WHY THE NIGHT IS POSED AS IT IS. Blaze alone on an empty field, every driver
// switch but `weaponFire` off: Blaze needs no target, so no enemy is posed, and
// no key is held, so the lamplighter stands still and every firing is about the
// same center. The zones are cleared between firings, so each tick's puddles
// are the only ones in the world.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) beyond the bound: the distance is a
// product of stated figures read back through the build's own trigonometry.
// `MOTION_TOLERANCE` (1e-6) as the least by which two landing points are read
// as distinct, so two puddles a build placed on one point through slightly
// different arithmetic are still read as one. Fifty independent uniform points
// of a disk coincide with probability zero.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { FIGURE_TOLERANCE, MOTION_TOLERANCE, OIL_SCATTER } from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  type Harness,
  type Point,
} from "../harness";
import { armEvolved } from "./evolved";
import { fireOnce } from "./blaze";

/** How many firings are sampled. */
const FIRINGS = 10;

/** Whether two points differ by more than `MOTION_TOLERANCE` on either axis. */
function differ(a: Point, b: Point): boolean {
  return (
    Math.abs(a.x - b.x) > MOTION_TOLERANCE ||
    Math.abs(a.y - b.y) > MOTION_TOLERANCE
  );
}

/** How many of `points` are distinct from every earlier one. */
function distinctCount(points: readonly Point[]): number {
  const kept: Point[] = [];
  for (const point of points) {
    if (kept.every((seen) => differ(seen, point))) kept.push(point);
  }
  return kept.length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands every puddle of ten firings within 400 of the lamplighter, and not all on one point", async () => {
  const { slot } = armEvolved(h, "blaze");
  const landings: Point[] = [];

  for (let firing = 1; firing <= FIRINGS; firing += 1) {
    if (firing > 1) h.debug.clearZones();
    const { after, created } = await fireOnce(h, slot);
    if (firing === FIRINGS) captureStill(h, "scatter");
    assertGreaterThan(created.length, 0, `puddles created on firing ${firing}`);
    const center = { x: after.run.player.x, y: after.run.player.y };
    for (const puddle of created) {
      assertLessThanOrEqual(
        distance(puddle, center),
        OIL_SCATTER + FIGURE_TOLERANCE,
        `firing ${firing}, puddle ${puddle.id}: distance from the lamplighter's center`,
      );
      landings.push({ x: puddle.x, y: puddle.y });
    }
  }

  assertGreaterThan(
    distinctCount(landings),
    1,
    `distinct landing points across ${FIRINGS} firings`,
  );
});
