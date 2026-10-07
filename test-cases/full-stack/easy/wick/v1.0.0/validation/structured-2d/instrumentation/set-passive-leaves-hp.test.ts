// Wick — instrumentation/set-passive-leaves-hp: with hp 100,
// `setPassive(0, 'tallow', 2)` reads back `maxHp` 130 and hp still 100.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setPassive(slot, id, level)`: "`hp` is untouched; `maxHp` ... follow from
// the next read"; the derived table: `maxHp` is `BASE_MAX_HP (100) +
// TALLOW_HP_PER_LEVEL (15) × Tallow`, 130 at level 2. (A Tallow level gained
// through an offer or a chest raises hp with it, `specs/progression.md`; the
// pose is not a gain.)
//
// THE POSE. An isolated run at full health, the call, read at the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BASE_MAX_HP, maxHpOf } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const LEVEL = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises maxHp and leaves hp where it was", async () => {
  const start = isolate(h);
  assertEqual(start.run.player.hp, BASE_MAX_HP, "hp before the pose");

  h.debug.setPassive(0, "tallow", LEVEL);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "kept");
  assertEqual(
    after.run.maxHp,
    maxHpOf(LEVEL),
    "run.maxHp after setPassive(0, 'tallow', 2)",
  );
  assertEqual(
    after.run.player.hp,
    BASE_MAX_HP,
    "player.hp after setPassive(0, 'tallow', 2)",
  );
});
