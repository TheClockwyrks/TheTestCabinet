// instrumentation/set-passive-leaves-hp — with hp 100,
// `setPassive(0, 'tallow', 2)` reads back maxHp 130 and hp still 100.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setPassive`: "`hp`
// is untouched; `maxHp` ... follow from the next read"; the "Derived from"
// table: `maxHp` is "`BASE_MAX_HP` (`100`) `+ TALLOW_HP_PER_LEVEL` (`15`) `×`
// the Tallow level held", 130 at level 2. The +15 a GAINED Tallow level adds
// (specs/passives.md) belongs to the level-up path, not to this pose.
//
// THE POSE. An isolated run at full health, the pose, the read back without
// a frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BASE_MAX_HP, derived } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const LEVEL = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises maxHp and leaves hp where it was", async () => {
  const posed = isolate(h);
  assertEqual(posed.run.player.hp, BASE_MAX_HP, "hp before the pose");

  h.debug.setPassive(0, "tallow", LEVEL);
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "kept");

  assertEqual(
    s.run.maxHp,
    derived.maxHp({ tallow: LEVEL }),
    "maxHp with Tallow 2",
  );
  assertEqual(s.run.player.hp, BASE_MAX_HP, "hp across the pose");
});
