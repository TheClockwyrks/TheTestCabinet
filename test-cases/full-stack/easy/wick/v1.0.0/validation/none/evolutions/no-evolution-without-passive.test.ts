// Wick — evolutions/no-evolution-without-passive: a maxed base whose recipe
// passive is not held does not evolve.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("The recipe"): a base
// is eligible when "it is held at `MAX_WEAPON_LEVEL` (`8`)" AND "the passive its
// recipe names is held, at any level", and the recipe table names Wick as
// Taper's. ("Opening a chest"), rule 1: "the first base weapon at
// `MAX_WEAPON_LEVEL` whose recipe passive is held at any level evolves". Oil is
// Ember's recipe passive rather than Taper's, so with Taper at `8`, Oil held and
// no Wick, no weapon is eligible and the chest falls to rule 2 or rule 3: "The
// result is `{ kind: "level", item, level }`" or "`{ kind: "heal" }`". Taper is
// at its max, so rule 2 cannot raise it either — "One held item below its max
// level, a base weapon below `MAX_WEAPON_LEVEL` or a passive below its own max"
// — and it stands at `8` whatever the chest did.
//
// THE POSE. An isolated night with Taper at level 8 through `setWeapon` and Oil
// at level 1 through `setPassive`, and the chest reached the real way through
// the harness's `openChest`. Oil rather than no passive at all, so the reading
// is the recipe's passive condition rather than an empty passive list.
//
// TOLERANCE. None: the slot's id, its level, and the result's kind are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  type Harness,
} from "../harness";
import { assertNoEvolutionHeld, assertNotEvolved, slotOf } from "./stage";

/** The slot Taper is posed in. */
const SLOT = 0;

/** The passive held instead of Wick: Ember's recipe passive, not Taper's. */
const OIL_LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves Taper held at level 8 and reports a level or heal result with Oil held and no Wick", async () => {
  await isolate(h);
  await holdWeapon(h, "taper", MAX_WEAPON_LEVEL, SLOT);
  await holdPassive(h, "oil", OIL_LEVEL);

  const opened = await openChest(h);
  await captureStill(h, "held");

  const slot = slotOf(opened, SLOT, "after the chest");
  assertEqual(slot.id, "taper", "the weapon in the slot after the chest");
  assertEqual(slot.level, MAX_WEAPON_LEVEL, "Taper's level after the chest");
  assertNoEvolutionHeld(opened, "after a chest with Taper 8 and no Wick");
  assertNotEvolved(opened, "a chest with Taper at level 8 and no Wick held");
});
