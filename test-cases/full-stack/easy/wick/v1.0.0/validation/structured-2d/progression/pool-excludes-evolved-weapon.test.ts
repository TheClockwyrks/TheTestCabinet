// Wick — progression/pool-excludes-evolved-weapon: an evolved weapon is never
// a candidate.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The
// candidate pool": "An evolved weapon is never a candidate". "Slots": "an
// evolved weapon has a single level and replaces its base weapon in the same
// slot". `specs/evolutions.md`, "What an evolution is": an evolved weapon "is
// never a level-up offer".
//
// THE POSE. An isolated `playing` run holding Pyre alone, the evolution of
// Taper, at its single level `1`. Weapon slots are still free, so the pool
// otherwise holds new weapons and every passive and the check reads a real
// pool. A build that offers `+1 level` on every held weapon without asking
// whether it is evolved puts `pyre` in the pool and fails here.
//
// THE TOLERANCE. Exact: the absence of one id from a list of ids.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotContains } from "../assert";
import {
  captureStill,
  createHarness,
  heldWeapon,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves pyre out of the pool while Pyre is held", async () => {
  isolate(h);
  holdWeapon(h, "pyre", 1);

  const overlay = await openLevelUp(h, 1);
  await h.frameDraw();
  captureStill(h, "evolved");

  assertEqual(overlay.screen, "levelup", "screen after the opening tick");
  assertEqual(
    heldWeapon(overlay, "pyre")?.level,
    1,
    "the level Pyre is held at (specs/evolutions.md)",
  );
  assertNotContains(
    overlay.run.pool,
    "pyre",
    "run.pool with the evolved weapon Pyre held (specs/progression.md, The candidate pool)",
  );
});
