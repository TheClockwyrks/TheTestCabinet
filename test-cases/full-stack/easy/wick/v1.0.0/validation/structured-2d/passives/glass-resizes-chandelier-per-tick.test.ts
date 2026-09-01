// passives/glass-resizes-chandelier-per-tick — Chandelier's orbit and its
// lanterns' radius follow `areaMul` on every tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Area: "A shape's
// lengths are fixed when it is created, with one exception: the Halo and
// Corona aura's radius and a Chandelier lantern's orbit and radius are
// recomputed on every tick from the level and `areaMul` in force on that
// tick." `specs/evolutions.md` (Chandelier) says the same, and gives the fixed
// row: `orbit` `120`, `radius` `20`, `amount` `4`. With no passive held
// `areaMul` is `1`, so the lanterns read radius `20` on an orbit of `120`;
// Glass 2 makes `areaMul` `1.2`, so the tick after the level is gained the
// same lanterns read radius `24` on an orbit of `144`.
//
// WHERE A LANTERN SITS. `specs/evolutions.md`, Chandelier: the lanterns are
// "on a circle of radius `orbit` centered on the player's center", "the circle
// they ride centered on the player's center every tick", so each lantern's
// center is exactly `orbit` from the lamplighter's whatever angle it holds.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Chandelier alone,
// with no passive and no enemy: nothing is hit, and the set is the only thing
// in the world. The set is created by the placement part of phase 5, which
// runs on every `playing` tick whatever the driver switches hold
// (`specs/instrumentation.md`), so one tick makes it and one more after the
// Glass level is all that is watched. `effectMotion` stays off, so the
// lanterns hold their angles and the amount never changes, which is what keeps
// the same four zones in the world across the level.
//
// THE TOLERANCE. `REAL_EPS` on each radius, one figure times one multiplier,
// and `MOTION_EPS` on each orbit, a distance between two centers; a build that
// fixed either at creation reports `20` and `120` where `24` and `144` are
// required.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { CHANDELIER_STATS, MOTION_EPS, REAL_EPS, areaMul } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  distance,
  holdPassive,
  type Harness,
  type WickSnapshot,
  zonesOfKind,
} from "../harness";
import { fireUnder } from "./firing";

/** The Glass level gained while the set is already in the world. */
const GLASS_LATER = 2;

/** What the fixed row carries with no passive held, and under Glass 2. */
const UNSCALED = {
  orbit: CHANDELIER_STATS.orbit,
  radius: CHANDELIER_STATS.radius,
};
const SCALED = {
  orbit: CHANDELIER_STATS.orbit * areaMul(GLASS_LATER),
  radius: CHANDELIER_STATS.radius * areaMul(GLASS_LATER),
};

/** Read the set's lanterns and hold each to `expected`. */
function assertSet(
  s: WickSnapshot,
  expected: { orbit: number; radius: number },
  when: string,
): void {
  const lanterns = zonesOfKind(s, "lantern");
  assertEqual(
    lanterns.length,
    CHANDELIER_STATS.amount,
    `the Chandelier lanterns in the world ${when} (specs/evolutions.md, Chandelier)`,
  );
  lanterns.forEach((lantern, i) => {
    assertNear(
      lantern.radius,
      expected.radius,
      REAL_EPS,
      `lantern ${i}: radius ${when} (specs/passives.md, Area)`,
    );
    assertNear(
      distance(lantern, s.run.player),
      expected.orbit,
      MOTION_EPS,
      `lantern ${i}: distance from the lamplighter ${when} (specs/passives.md, Area)`,
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

it("reads Chandelier's lanterns at radius 20 on an orbit of 120 and at 24 on 144 after Glass rises to 2", async () => {
  const firing = await fireUnder(h, { weapons: [["chandelier", 1]] });
  assertSet(firing.after, UNSCALED, "with no passive held");

  holdPassive(h, "glass", GLASS_LATER);
  const later = await advanceTicks(h, 1);
  captureStill(h, "resized");
  assertSet(later, SCALED, "on the tick after Glass rose to 2");
});
