// Wick — progression/lamp-oil-heals: accepting lamp oil restores
// `LAMP_OIL_HEAL` health.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`,
// "Choosing", the offer table: for `lamp-oil`, "`hp` rises by `LAMP_OIL_HEAL`,
// capped at `maxHp`", with `LAMP_OIL_HEAL` (`30`). "The draw": an empty pool
// "offers exactly one item, `LAMP_OIL_ID`". `specs/instrumentation.md`,
// `choose(index)`: it "accepts the offer at `index` ... exactly as moving the
// highlight there and pressing `confirm` would".
//
// THE POSE. An isolated `playing` run whose slots are saturated, so the pool is
// empty and the single offer is lamp oil. `hp` is posed to `50` before the
// overlay opens, since `setHp` applies on a run screen. The six passives held
// leave Tallow out, so `maxHp` stands at `BASE_MAX_HP` (`100`,
// `specs/world.md`) and `50 + 30` is well under the cap: what is read is the
// heal itself and not the cap. Nothing else can move `hp`, since every driver
// switch is off, the world is empty, and no tick runs between the pose and the
// acceptance.
//
// THE TOLERANCE. `REAL_EPS` on `hp`, a real number that is here a sum of two
// whole numbers.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import {
  BASE_MAX_HP,
  LAMP_OIL_HEAL,
  LAMP_OIL_ID,
  REAL_EPS,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { saturate } from "./loadout";

/** Low enough that `LAMP_OIL_HEAL` lands clear of `maxHp`. */
const HP_BEFORE = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises hp from 50 to 80 when lamp oil is accepted", async () => {
  isolate(h);
  saturate(h);
  h.debug.setHp(HP_BEFORE);

  const overlay = await openLevelUp(h, 1);
  assertDeepEqual(
    overlay.run.offers,
    [LAMP_OIL_ID],
    "run.offers over the empty pool",
  );
  assertEqual(overlay.run.maxHp, BASE_MAX_HP, "run.maxHp with no Tallow held");
  assertEqual(
    overlay.run.player.hp,
    HP_BEFORE,
    "run.player.hp before the heal",
  );

  h.debug.choose(0);
  const healed = h.snapshot();
  await h.frameDraw();
  captureStill(h, "healed");

  assertNear(
    healed.run.player.hp,
    HP_BEFORE + LAMP_OIL_HEAL,
    REAL_EPS,
    "run.player.hp after accepting lamp-oil (specs/progression.md, Choosing)",
  );
});
