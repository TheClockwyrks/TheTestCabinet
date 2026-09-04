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
import { assertLength, assertWithin } from "../assert";
import {
  CHANDELIER_STATS,
  FIGURE_TOLERANCE,
  derived,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  zonesOfKind,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** The Glass level gained while the set lives. */
const GLASS = 2;

/** areaMul with nothing held, then with Glass 2 held. */
const BEFORE = derived.areaMul({});
const AFTER = derived.areaMul({ glass: GLASS } satisfies HeldPassives);

/** Read every lantern's radius against the fixed row times `area`. */
function assertSet(snapshot: WickSnapshot, area: number, when: string): void {
  const lanterns = zonesOfKind(snapshot, "lantern");
  assertLength(lanterns, CHANDELIER_STATS.amount, `lanterns ${when}`);
  for (const lantern of lanterns) {
    assertWithin(
      lantern.radius,
      CHANDELIER_STATS.radius * area,
      FIGURE_TOLERANCE,
      `lantern ${lantern.id}: radius ${when}`,
    );
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads Chandelier at radius 20, and 24 after Glass reaches 2", async () => {
  isolate(h);
  holdWeapon(h, "chandelier", 1);

  const placed = await h.tick(1);
  assertSet(placed, BEFORE, "with no Glass held");

  holdPassive(h, "glass", GLASS);
  const resized = await h.tick(1);
  captureStill(h, "resized");

  assertSet(resized, AFTER, "on the tick after Glass reached 2");
});
