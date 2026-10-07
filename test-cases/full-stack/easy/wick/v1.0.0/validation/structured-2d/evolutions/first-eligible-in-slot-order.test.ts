// evolutions/first-eligible-in-slot-order — one chest evolves the first
// eligible weapon in slot order and no other.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Opening a chest"),
// rule 1: "The held weapons are checked in slot order, first slot first, and
// the first base weapon at `MAX_WEAPON_LEVEL` whose recipe passive is held at
// any level evolves ... One chest evolves at most one weapon." The recipe
// table gives Beacon as Ember's evolution with Oil as its passive, and Pyre as
// Taper's with Wick. So with Ember at 8 in slot 0, Taper at 8 in slot 1, and
// both Oil and Wick held, the chest evolves Ember alone: `weapons[0]` reads
// `beacon` at level 1, `weapons[1]` still reads `taper` at 8, and
// `chestResult` reads `{ kind: "evolve", weapon: "beacon" }`.
//
// WHY THE SLOTS ARE FILLED IN THIS ORDER. `specs/progression.md` ("Slots"):
// "An item enters the first free slot of its kind ... so slot order is
// acquisition order", and `setWeapon` places a weapon in the slot it is given
// (`specs/instrumentation.md`), so filling slot 0 then slot 1 poses exactly
// the order the rule reads. Ember in slot 0 is the weapon the rule reaches
// first, and Taper — the other eligible pair — is the one it must pass over.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding those two weapons
// and those two passives and nothing else, every driver switch off, so the
// tick that collects the chest fires nothing and moves nothing.
//
// THE TOLERANCE. None: two slots' ids and levels, and a result object, are
// read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertUndefined } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  heldWeapon,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("evolves the Ember in slot 0 into Beacon and leaves the Taper in slot 1 at 8", async () => {
  isolate(h);
  const first = holdWeapon(h, "ember", MAX_WEAPON_LEVEL);
  const second = holdWeapon(h, "taper", MAX_WEAPON_LEVEL);
  holdPassive(h, "oil", 1);
  holdPassive(h, "wick", 1);
  assertEqual(first, 0, "the slot Ember took (specs/progression.md, Slots)");
  assertEqual(second, 1, "the slot Taper took (specs/progression.md, Slots)");

  const after = await openChest(h);
  captureStill(h, "first");

  assertEqual(
    after.run.weapons[first]?.id,
    "beacon",
    "the weapon in slot 0, the first eligible in slot order (specs/evolutions.md, Opening a chest)",
  );
  assertEqual(
    after.run.weapons[second]?.id,
    "taper",
    "the weapon in slot 1, which one chest must leave alone (specs/evolutions.md, Opening a chest)",
  );
  assertEqual(
    after.run.weapons[second]?.level,
    MAX_WEAPON_LEVEL,
    "Taper's level in slot 1 after the chest",
  );
  assertUndefined(
    heldWeapon(after, "pyre"),
    "the slot holding Pyre after a chest that evolved Ember (specs/evolutions.md, Opening a chest)",
  );
  assertDeepEqual(
    after.run.chestResult,
    { kind: "evolve", weapon: "beacon" },
    "the chest's result (specs/evolutions.md, Opening a chest)",
  );
});
