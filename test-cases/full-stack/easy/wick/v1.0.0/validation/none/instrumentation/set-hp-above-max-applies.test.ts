// Wick — instrumentation/set-hp-above-max-applies: with `maxHp` 100,
// `setHp(101)` leaves the health at 101.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setHp(hp)`):
// "Sets `hp` to `hp`, a real number, and there is no bound either way. `maxHp`
// is worked out from the passives held and moves as they change, so it is what
// ordinary play holds the health under rather than a limit on this pose: a
// value above it is applied as it was given."
//
// WHY THE WORLD IS POSED AS IT IS. No Tallow held, so `maxHp` is
// `BASE_MAX_HP`; `101` is the nearest whole figure past it, so a build that
// clamps to the maximum and one that refuses the figure both fail.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BASE_MAX_HP } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("applies a value above maxHp as it was given", async () => {
  const posed = await isolate(h);
  assertEqual(posed.run.maxHp, BASE_MAX_HP, "maxHp with no Tallow held");

  await h.debug.setHp(BASE_MAX_HP + 1);
  await h.debug.reconcile();
  const after = await h.snapshot();
  await captureStill(h, "posed");

  assertEqual(after.run.player.hp, BASE_MAX_HP + 1, "hp after setHp(101)");
  assertEqual(after.run.maxHp, BASE_MAX_HP, "maxHp, which the pose leaves");
});
