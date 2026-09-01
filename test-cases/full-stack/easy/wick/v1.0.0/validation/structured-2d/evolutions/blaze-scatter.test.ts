// evolutions/blaze-scatter — Blaze's puddles land within OIL_SCATTER.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Blaze"): "on each
// firing, `amount` puddles appear, each centered at an independent uniformly
// random point of the disk of radius `OIL_SCATTER` (`400`) about the player's
// center". `specs/passives.md` ("What passives leave as written") and
// `specs/weapons.md` ("Derived stats") both keep `OIL_SCATTER` unscaled, so
// with no passive held the disk is exactly 400 units about the lamplighter's
// center. `specs/world.md` ("One tick"), phase 5 creates a firing's zones "at
// the lamplighter's ... positions of this tick", and a puddle "stays where it
// landed", so each puddle's center on its firing tick is its landing point.
//
// WHAT IS ASSERTED. Two things the one rule fixes: every puddle of ten
// firings is at most 400 units from the lamplighter's center, and the fifty
// landing points are not all one point. INDEPENDENT and UNIFORM cannot both be
// tested by a bound, but a build that dropped every puddle on the lamplighter
// — the one arrangement that satisfies the bound while drawing nothing — fails
// the second reading.
//
// WHY TEN FIRINGS. Fifty landing points from one seeded generator, enough that
// a build drawing from a disk of the wrong size shows a point outside 400
// (a draw lands beyond any radius `r < 400` with probability
// `1 − (r / 400)^2` per puddle) while a conformant build cannot.
//
// HOW THE FIRINGS ARE MADE. The first through the arming that makes the next
// tick a firing, each of the nine after by posing the timer back to `0` and
// running one more tick ("`setWeaponCooldown(slot, 0)` makes that the next
// tick", `specs/instrumentation.md`) — so the run's generator carries on from
// wherever the last firing left it, and every landing point is a draw of its
// own. Each firing's puddles are told from the ones still standing by their
// ids, which every entity takes from `nextId`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy and no
// passive, the lamplighter posed off the origin so a build that scattered
// about the WORLD origin is caught by the bound, and every switch off but
// `weaponFire`, so nothing moves the lamplighter or the puddles between the
// firings.
//
// THE TOLERANCE. `REAL_EPS` on the bound, a distance the build reaches by one
// square root of a draw; a landing point outside the disk is outside it by
// units.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { BLAZE_STATS, OIL_SCATTER, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  distance,
  zonesCreatedSince,
  type Harness,
  type Point,
} from "../harness";
import { POSED, fireEvolved, playerCenter } from "./evolved";

/** How many firings are watched. */
const FIRINGS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands every puddle of ten firings within 400 units of the lamplighter, on more than one point", async () => {
  const firing = await fireEvolved(h, "blaze", POSED);
  const center = playerCenter(firing.after);
  const landed: Point[] = firing.zones.map((puddle) => ({
    x: puddle.x,
    y: puddle.y,
  }));

  for (let round = 2; round <= FIRINGS; round += 1) {
    h.debug.setWeaponCooldown(firing.slot, 0);
    const before = h.snapshot();
    const after = await advanceTicks(h, 1);
    const puddles = zonesCreatedSince(before, after).filter(
      (zone) => zone.weapon === "blaze",
    );
    assertEqual(
      puddles.length,
      BLAZE_STATS.amount,
      `the puddles firing ${round} created (specs/evolutions.md, Blaze)`,
    );
    for (const puddle of puddles) landed.push({ x: puddle.x, y: puddle.y });
  }
  captureStill(h, "scatter");

  assertEqual(
    landed.length,
    FIRINGS * BLAZE_STATS.amount,
    `the puddles ${FIRINGS} firings created (specs/evolutions.md, Blaze)`,
  );
  for (const point of landed) {
    assertLessThanOrEqual(
      distance(center, point),
      OIL_SCATTER + REAL_EPS,
      `a puddle's distance from the lamplighter's center, landing at (${point.x.toFixed(2)}, ${point.y.toFixed(2)}) (specs/evolutions.md, Blaze)`,
    );
  }
  const distinct = new Set(landed.map((point) => `${point.x},${point.y}`));
  assertGreaterThan(
    distinct.size,
    1,
    `the distinct landing points among the ${landed.length} puddles, each an independent draw (specs/evolutions.md, Blaze)`,
  );
});
