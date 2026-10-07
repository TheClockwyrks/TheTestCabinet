// Wick — progression/lamp-oil-fills-no-slot: lamp oil takes no weapon or
// passive slot.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The draw":
// "the overlay offers exactly one item, `LAMP_OIL_ID`, WHICH FILLS NO SLOT",
// and "Choosing": lamp oil's whole effect is that "`hp` rises by
// `LAMP_OIL_HEAL`, capped at `maxHp`", and "Lamp oil is never held".
//
// THE POSE. An isolated `playing` run whose slots are saturated, so the pool is
// empty and the single offer is lamp oil. The slots are read before the
// overlay opens and again after the acceptance, whole: every id, level, and
// cooldown timer. No tick runs between the two readings and every driver
// switch is off, so a build that honors the rule reads them identical. A build
// that files lamp oil into a slot, or that renumbers or re-times the slots
// while accepting it, differs here.
//
// THE TOLERANCE. Exact: two lists of slots compared field for field.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { LAMP_OIL_ID } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { saturate } from "./loadout";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the weapon and passive slots exactly as they were", async () => {
  isolate(h);
  saturate(h);

  const overlay = await openLevelUp(h, 1);
  assertDeepEqual(
    overlay.run.offers,
    [LAMP_OIL_ID],
    "run.offers over the empty pool",
  );
  const before = overlay.run;

  h.debug.choose(0);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "slots");

  assertDeepEqual(
    after.run.weapons,
    before.weapons,
    "run.weapons after accepting lamp-oil (specs/progression.md, The draw)",
  );
  assertDeepEqual(
    after.run.passives,
    before.passives,
    "run.passives after accepting lamp-oil",
  );
});
