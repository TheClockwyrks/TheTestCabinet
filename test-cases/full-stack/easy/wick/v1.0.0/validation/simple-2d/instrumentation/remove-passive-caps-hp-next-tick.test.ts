// instrumentation/remove-passive-caps-hp-next-tick — with Tallow 2 held and
// hp 130, `removePassive` on Tallow's slot reads back maxHp 100 with hp 130
// until the next playing tick, after which hp reads 100.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `removePassive`:
// "`hp` is capped at the new `maxHp` on the next tick's recovery step".
// specs/world.md, "Health and recovery": "On every tick ... `hp = min(maxHp,
// hp + recovery × TICK_DT)`", with no Tinder held recovery is 0.
//
// THE POSE. An isolated run holding Tallow 2 with hp posed to its 130 max,
// the removal, the read back without a frame, then one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BASE_MAX_HP, derived } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";

const TALLOW = 2;
const FULL = derived.maxHp({ tallow: TALLOW });

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lowers maxHp at once and caps hp on the next tick", async () => {
  isolate(h);
  const tallow = holdPassive(h, "tallow", TALLOW);
  h.debug.setHp(FULL);
  assertEqual(h.snapshot().run.player.hp, FULL, "hp at the Tallow max");

  h.debug.removePassive(tallow);
  const s = h.snapshot();
  assertEqual(s.run.maxHp, BASE_MAX_HP, "maxHp after the removal");
  assertEqual(s.run.player.hp, FULL, "hp until the next tick");

  const after = await h.tick(1);
  captureStill(h, "capped");
  assertEqual(
    after.run.player.hp,
    BASE_MAX_HP,
    "hp after the next tick's recovery step",
  );
});
