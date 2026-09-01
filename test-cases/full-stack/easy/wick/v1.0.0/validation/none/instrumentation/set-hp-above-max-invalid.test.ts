// Wick — instrumentation/set-hp-above-max-invalid: with `maxHp` 100,
// `setHp(101)` throws and leaves `hp` as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setHp(hp)`): "a
// real number at most `maxHp`; a value above `maxHp` is invalid"; and "An
// argument outside the domain its operation states is invalid, and the call
// throws rather than guessing what was meant; no operation rounds, clamps, or
// otherwise normalizes an argument."
//
// WHY THE WORLD IS POSED AS IT IS. No Tallow held, so `maxHp` is
// `BASE_MAX_HP`; `101` is the nearest whole figure past it, so a build that
// clamps to the maximum and one that accepts the figure both fail.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertRejects } from "../assert";
import { BASE_MAX_HP } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on a value above maxHp and leaves hp as it was", async () => {
  const posed = await isolate(h);
  assertEqual(posed.run.maxHp, BASE_MAX_HP, "maxHp with no Tallow held");
  assertEqual(posed.run.player.hp, BASE_MAX_HP, "hp before the refused call");

  await assertRejects(() => h.debug.setHp(BASE_MAX_HP + 1), "setHp(101)");
  const after = await h.snapshot();
  await captureStill(h, "refused");
  assertEqual(after.run.player.hp, BASE_MAX_HP, "hp after the refused call");
});
