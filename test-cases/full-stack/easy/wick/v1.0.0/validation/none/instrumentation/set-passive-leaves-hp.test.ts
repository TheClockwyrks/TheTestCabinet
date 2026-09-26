// Wick — instrumentation/set-passive-leaves-hp: with `hp` 100,
// `setPassive(0, "tallow", 2)` reads back `maxHp` 130 and `hp` still 100.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setPassive(slot, id, level)`): "`hp` is untouched; `maxHp`, `armor`,
// `moveSpeed`, `pickupRadius`, and every multiplier follow from the next
// read." `maxHp` is "`BASE_MAX_HP` (`100`) `+ TALLOW_HP_PER_LEVEL` (`15`) `×`
// the Tallow level held", 130 at level 2.
//
// WHY THE WORLD IS POSED AS IT IS. Tallow is the passive whose GAIN through
// play raises `hp` with `maxHp` (specs/passives.md), so it is the one where a
// pose that routed through the gain path would show: a build doing so reads
// 130 on both.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BASE_MAX_HP, maxHpOf } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const LEVEL = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves hp untouched while maxHp follows", async () => {
  const posed = await isolate(h);
  assertEqual(posed.run.player.hp, BASE_MAX_HP, "hp before the pose");

  await h.debug.setPassive(0, "tallow", LEVEL);
  const after = await h.snapshot();
  await captureStill(h, "kept");
  assertEqual(
    after.run.maxHp,
    maxHpOf({ tallow: LEVEL }),
    "maxHp with Tallow 2",
  );
  assertEqual(after.run.player.hp, BASE_MAX_HP, "hp across the Tallow pose");
});
