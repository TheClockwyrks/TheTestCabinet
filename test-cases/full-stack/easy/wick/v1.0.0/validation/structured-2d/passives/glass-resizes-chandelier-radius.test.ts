// Wick — passives/glass-resizes-chandelier-radius: a Chandelier lantern's
// radius is recomputed from `areaMul` on every tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): "A shape's
// lengths are fixed when it is created, with one exception: the Halo and
// Corona aura's radius and a Chandelier lantern's orbit and radius are
// recomputed on every tick from the level and `areaMul` in force on that
// tick." `specs/evolutions.md` ("Chandelier") says the same, over the fixed
// row `CHANDELIER_STATS`, orbit `120`, radius `20`, amount `4`. `areaMul` is
// `1` with no Glass held and `1.2` at Glass 2 (`GLASS_AREA_PER_LEVEL` `0.1`),
// so the lanterns read radius 20 and then 24. The other length recomputed with
// it is `passives/glass-resizes-chandelier-orbit`.
//
// THE POSE. An isolated night with Chandelier held through `setWeapon` and one
// tick, which creates the set; the four lanterns are read. Glass 2 is then
// placed through `setPassive` and one more tick runs. Every faculty stays
// held: Chandelier "has no cooldown", and with `effectMotion` off the lanterns
// hold their angles, so the distance read is the circle the placement put them
// on. The lamplighter stands at the origin throughout, so that distance is the
// orbit itself.
//
// TOLERANCE. `FLOAT_TOL` on the radius and `POSITION_TOL` (`1e-6`) on the
// orbit, a distance a build computed from a cosine and a sine. A build that
// fixed the length at creation is units away on the second reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { CHANDELIER_STATS, REAL_EPS, areaMul } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdPassive,
  type Harness,
  type WickSnapshot,
  zonesOfKind,
} from "../harness";
import { fireUnder } from "./firing";

/** The Glass level gained while the set is already in the world. */
const GLASS_LATER = 2;

/** Read every lantern's radius against the fixed row times `area`. */
function assertSet(s: WickSnapshot, area: number, when: string): void {
  const lanterns = zonesOfKind(s, "lantern");
  assertEqual(
    lanterns.length,
    CHANDELIER_STATS.amount,
    `the Chandelier lanterns in the world ${when} (specs/evolutions.md, Chandelier)`,
  );
  lanterns.forEach((lantern, i) => {
    assertNear(
      lantern.radius,
      CHANDELIER_STATS.radius * area,
      REAL_EPS,
      `lantern ${i}: radius ${when} (specs/passives.md, Area)`,
    );
  });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads Chandelier's lanterns at radius 20 and then 24 after Glass rises to 2", async () => {
  const firing = await fireUnder(h, { weapons: [["chandelier", 1]] });
  assertSet(firing.after, 1, "with no passive held");

  holdPassive(h, "glass", GLASS_LATER);
  const later = await advanceTicks(h, 1);
  captureStill(h, "resized");
  assertSet(later, areaMul(GLASS_LATER), "on the tick after Glass rose to 2");
});
