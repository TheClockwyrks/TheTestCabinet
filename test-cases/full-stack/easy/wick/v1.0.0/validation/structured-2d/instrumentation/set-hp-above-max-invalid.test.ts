// Wick — instrumentation/set-hp-above-max-invalid: with `maxHp` 100,
// `setHp(101)` throws and leaves hp as it was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setHp(hp)`: "a real number at most `maxHp`; a value above `maxHp` is
// invalid"; "An argument outside the domain its operation states is invalid,
// and the call throws rather than guessing what was meant; no operation
// rounds, clamps, or otherwise normalizes an argument."
//
// THE POSE. An isolated run with no Tallow, so `maxHp` is `BASE_MAX_HP`; the
// call, and the whole snapshot compared with the one before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertThrows } from "../assert";
import { BASE_MAX_HP } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("throws for hp above maxHp and changes nothing", async () => {
  const before = isolate(h);
  assertEqual(before.run.maxHp, BASE_MAX_HP, "maxHp with no Tallow held");

  assertThrows(() => h.debug.setHp(BASE_MAX_HP + 1), "setHp(101)");
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "refused");
  assertEqual(
    after.run.player.hp,
    before.run.player.hp,
    "player.hp after the refused call",
  );
  assertDeepEqual(after, before, "snapshot after the refused call");
});
