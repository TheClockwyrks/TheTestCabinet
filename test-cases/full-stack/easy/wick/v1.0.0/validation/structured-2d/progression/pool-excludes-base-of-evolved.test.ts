// Wick — progression/pool-excludes-base-of-evolved: the base weapon of a held
// evolution is not a candidate either.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The
// candidate pool": "An evolved weapon is never a candidate, and neither is the
// base weapon it came from", and a new base weapon enters the pool only when
// its "evolution is not held". `specs/evolutions.md`, "The recipe": Pyre comes
// from Taper; "What an evolution is": "while the evolved weapon is held that
// base weapon is not a level-up candidate either".
//
// THE POSE. An isolated `playing` run holding Pyre alone, so Taper is unheld
// and five weapon slots are free: the free slot is exactly the condition that
// would otherwise offer Taper as a new item, so the check reads the evolution
// clause rather than the full-slots clause. Every driver switch is off and the
// world is empty.
//
// THE TOLERANCE. Exact: the absence of one id from a list of ids.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertLessThan,
  assertNotContains,
} from "../assert";
import { EVOLUTIONS, WEAPON_SLOTS } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The base weapon Pyre replaces (`specs/evolutions.md`, The recipe). */
const BASE = EVOLUTIONS.pyre.from;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves taper out of the pool while Pyre is held and a weapon slot is free", async () => {
  isolate(h);
  holdWeapon(h, "pyre", 1);

  const overlay = await openLevelUp(h, 1);
  await h.frameDraw();
  captureStill(h, "base");

  assertEqual(overlay.screen, "levelup", "screen after the opening tick");
  assertLessThan(
    overlay.run.weapons.length,
    WEAPON_SLOTS,
    "weapon slots filled, so one stands free (specs/progression.md, Slots)",
  );
  assertContains(
    overlay.run.pool,
    "ember",
    "run.pool holding an unheld base weapon with no evolution held",
  );
  assertNotContains(
    overlay.run.pool,
    BASE,
    "run.pool with Pyre, Taper's evolution, held (specs/progression.md, The candidate pool)",
  );
});
