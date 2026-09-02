// Wick — evolutions/blaze-scatter: every Blaze puddle lands within
// `OIL_SCATTER` of the lamplighter, and the landings are drawn rather than
// fixed.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Blaze"): "on each
// firing, `amount` puddles appear, each centered at an independent uniformly
// random point of the disk of radius `OIL_SCATTER` (`400`) about the player's
// center". `specs/passives.md` ("Area") leaves `OIL_SCATTER` among the lengths
// "used exactly as its table or constant states it", and none is held anyway. So
// the distance from the lamplighter's center on the firing tick to each puddle's
// center is at most `400`, and "independent uniformly random" rules out a build
// that lands every puddle on one point.
//
// WHAT IS READ. Ten firings, each read as the puddles its tick created against
// the lamplighter's center of that tick, all at once against the one bound.
// `BLAZE_STATS` fires five puddles a firing, so the ten firings draw fifty
// landing points. The lamplighter is posed off the origin first, so a build
// scattering about `(0, 0)` rather than about the player is read against the
// right center.
//
// THE POSE. An isolated night, the lamplighter at `(300, -200)`, Blaze alone
// fired through the shared `fireWeapon` and then nine times more, each a timer
// re-armed to `0` through `setWeaponCooldown` and one tick — "a timer at `0`
// stays due on every tick until it is set again" (`specs/world.md`). Nothing
// else runs and no enemy is posed, so the puddles pulse on nothing.
//
// TOLERANCE. `POSITION_TOL` above `OIL_SCATTER` on each distance: the bound is
// strict in the specification, and the tolerance only covers a build whose draw
// rounds `sqrt(u)` to exactly `1`. Two landing points count as one when they are
// within `POSITION_TOL` of each other.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { OIL_SCATTER, POSITION_TOL, weaponRow } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  distanceBetween,
  isolate,
  fireWeapon,
  newZones,
  type Harness,
  type XY,
} from "../harness";
import { centerOf, distinctPoints } from "./stage";

/** Blaze's fixed amount, `5`. */
const AMOUNT = weaponRow("blaze").amount as number;

/** How many firings are read, as the review item states. */
const FIRINGS = 10;

/** Where the lamplighter stands: off the origin, so the center is the player's. */
const PLAYER = { x: 300, y: -200 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands every puddle of ten firings within 400 of the lamplighter's center, on more than one point", async () => {
  await isolate(h);
  await h.debug.setPlayerPosition(PLAYER.x, PLAYER.y);

  const landings: XY[] = [];
  const readings: { firing: number; puddle: number; distance: number }[] = [];
  const firing = await fireWeapon(h, "blaze", 1);
  let before = firing.before;
  let after = firing.after;
  for (let index = 0; index < FIRINGS; index += 1) {
    if (index > 0) {
      await armWeapon(h, firing.slot);
      before = await h.snapshot();
      after = await h.step(1);
    }
    const puddles = newZones(before, after).filter(
      (zone) => zone.kind === "puddle" && zone.weapon === "blaze",
    );
    assertEqual(
      puddles.length,
      AMOUNT,
      `Blaze puddles firing ${index} created`,
    );
    const at = after.run.player;
    for (const puddle of puddles) {
      landings.push(centerOf(puddle));
      readings.push({
        firing: index,
        puddle: puddle.id,
        distance: distanceBetween(centerOf(puddle), at),
      });
    }
  }
  await captureStill(h, "scatter");

  for (const reading of readings) {
    assertLessThanOrEqual(
      reading.distance,
      OIL_SCATTER + POSITION_TOL,
      `the distance from the lamplighter's center to puddle ${reading.puddle} of firing ${reading.firing}`,
    );
  }
  assertGreaterThan(
    distinctPoints(landings).length,
    1,
    `distinct landing points among the ${landings.length} puddles of ${FIRINGS} firings`,
  );
});
