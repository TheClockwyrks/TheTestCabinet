// instrumentation/set-hp-above-max-invalid — with maxHp 100, `setHp(101)`
// throws and leaves hp as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setHp`: "a real
// number at most `maxHp`; a value above `maxHp` is invalid"; and "An argument
// outside the domain its operation states is invalid, and the call throws
// rather than guessing what was meant; no operation rounds, clamps, or
// otherwise normalizes an argument".
//
// THE POSE. An isolated run with no Tallow, so maxHp is BASE_MAX_HP, hp
// posed to a figure below it first so "as it was" is not the maximum, then
// the refused call and the whole snapshot against the reading before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertThrows } from "../assert";
import { BASE_MAX_HP } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const HELD_HP = 70;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a value above maxHp and changes nothing", async () => {
  isolate(h);
  h.debug.setHp(HELD_HP);
  const before = h.snapshot();
  assertEqual(before.run.maxHp, BASE_MAX_HP, "maxHp with no Tallow");

  assertThrows(
    () => h.debug.setHp(BASE_MAX_HP + 1),
    "setHp(101) with maxHp 100",
  );
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "refused");

  assertEqual(s.run.player.hp, HELD_HP, "hp after the refused pose");
  assertDeepEqual(s, before, "the snapshot across the refused pose");
});
