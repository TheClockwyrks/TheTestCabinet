// progression/lamp-oil-fills-no-slot — lamp-oil fills no slot.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The draw"): "the
// overlay offers exactly one item, `LAMP_OIL_ID`, WHICH FILLS NO SLOT", and
// "Choosing": "Lamp oil is never held". The offer table gives its whole effect
// as "`hp` rises by `LAMP_OIL_HEAL`, capped at `maxHp`", so nothing about the
// weapon or passive slots moves when it is accepted.
//
// WHY THE WORLD IS POSED AS IT IS. The empty-pool loadout, which is the only
// arrangement lamp-oil is offered under, and one that reads the rule at its
// hardest: both slot kinds are already full, so a build that treats the fallback
// as an item has nowhere to put it and must either overwrite a slot or grow the
// loadout past `WEAPON_SLOTS` or `PASSIVE_SLOTS`. Both slot lists are read whole
// before and after the acceptance, ids, levels and running timers alike, so
// either shows. Nothing is stepped between the two readings, so a difference is
// the acceptance's.
//
// THE TOLERANCE. None: the two lists are compared entry for entry.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { LAMP_OIL_ID } from "../constants";
import {
  captureStill,
  createHarness,
  openLevelUp,
  type Harness,
} from "../harness";
import { poseEmptyPool } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves both slot lists exactly as they stood", async () => {
  await poseEmptyPool(h);

  const overlay = await openLevelUp(h);
  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertDeepEqual(
    overlay.run.offers,
    [LAMP_OIL_ID],
    "the offers over an empty pool",
  );

  await h.debug.choose(0);
  const after = await h.snapshot();
  await captureStill(h, "slots");

  assertDeepEqual(
    after.run.weapons,
    overlay.run.weapons,
    "the weapon slots after accepting lamp-oil",
  );
  assertDeepEqual(
    after.run.passives,
    overlay.run.passives,
    "the passive slots after accepting lamp-oil",
  );
});
