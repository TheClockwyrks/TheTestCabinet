// Wick — evolutions/evolves-when-eligible: a maxed base beside its recipe
// passive evolves on a chest.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("The recipe"): "A base
// weapon is eligible to evolve when all three hold at once: it is held at
// `MAX_WEAPON_LEVEL` (`8`); the passive its recipe names is held, at any level;
// the player opens a chest", and the recipe table gives Pyre as Taper's
// evolution with Wick as its passive. ("Opening a chest"), rule 1: "the first
// base weapon at `MAX_WEAPON_LEVEL` whose recipe passive is held at any level
// evolves ... The evolved weapon replaces its base in the same slot with a
// single level ... The result is `{ kind: "evolve", weapon }`." So with Taper
// at `8` in slot `0` and Wick `1` held, the tick that collects a chest leaves
// slot `0` holding `pyre` at level `1`, no `taper` in any slot, and
// `chestResult` reading `{ kind: "evolve", weapon: "pyre" }`.
//
// THE POSE. An isolated night — nothing alive, nothing dropped, every driver
// switch off, no weapon and no passive held — then Taper at level 8 through
// `setWeapon` and Wick at level 1 through `setPassive`, and the chest reached
// the real way: `spawnPickup("chest", x, y)` at the lamplighter's center and
// one tick, which is the harness's `openChest`. Nothing else runs on that tick:
// no spawn, no event, no firing, no motion. The level is lifted out of reach by
// `isolate`, so nothing the tick does opens a level-up overlay over the chest.
//
// TOLERANCE. None: the slot's id and level, the absence of Taper, and the two
// fields of the result are all exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  weaponIn,
  type Harness,
} from "../harness";
import { chestOutcome, slotOf } from "./stage";

/** The slot Taper is posed in: the first, so slot order is not in question. */
const SLOT = 0;

/** Wick's level: "the passive its recipe names is held, at any level". */
const WICK_LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves Pyre at level 1 in Taper's slot with no Taper held and reports an evolve result", async () => {
  await isolate(h);
  await holdWeapon(h, "taper", MAX_WEAPON_LEVEL, SLOT);
  await holdPassive(h, "wick", WICK_LEVEL);

  const opened = await openChest(h);
  await captureStill(h, "evolved");

  const slot = slotOf(opened, SLOT, "after the chest");
  assertEqual(slot.id, "pyre", "the weapon in Taper's slot after the chest");
  assertEqual(slot.level, 1, "Pyre's level after the chest");
  assertUndefined(weaponIn(opened, "taper"), "Taper held after the chest");
  const result = chestOutcome(opened, "the chest with Taper 8 and Wick held");
  assertEqual(result.kind, "evolve", "the chest result's kind");
  assertEqual(
    result.kind === "evolve" ? result.weapon : undefined,
    "pyre",
    "the chest result's weapon",
  );
});
