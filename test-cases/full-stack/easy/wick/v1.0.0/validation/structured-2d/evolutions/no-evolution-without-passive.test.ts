// evolutions/no-evolution-without-passive — a maxed base without its recipe
// passive does not evolve.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("The recipe"): "A
// base weapon is eligible to evolve when all three hold at once: it is held at
// `MAX_WEAPON_LEVEL` (`8`); the passive its recipe names is held, at any
// level; the player opens a chest", and the recipe table names Wick as
// Taper's. Oil is the recipe passive of Beacon, not of Pyre, so Taper at 8
// beside Oil fails the second condition and rule 1 of ("Opening a chest")
// finds nothing to evolve. Rule 2 then applies, since Oil at 1 is below its
// max of 5 (`specs/passives.md`): "One held item below its max level ... rises
// by `1` ... The result is `{ kind: "level", item, level }`." Taper is at
// `MAX_WEAPON_LEVEL` and so is not among the items rule 2 can raise, and it is
// left where it stands.
//
// WHY THE PASSIVE HELD IS OIL. A run holding no passive at all would leave
// rule 2 with nothing but a maxed Taper and fall to the heal, which is
// `chest-fallback-heal`'s point; holding one passive that is the WRONG one
// tests the recipe rather than the absence of any passive, and a build that
// evolves on any held passive fails here.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but Taper
// at 8 and Oil 1, every driver switch off, so the tick that collects the chest
// fires nothing, spawns nothing and moves nothing.
//
// THE TOLERANCE. None: a slot's id and level, and a result's kind, are read
// exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
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
import { chestResultOf } from "./evolved";

/** The passive held: Beacon's recipe passive, not Pyre's. */
const WRONG_PASSIVE = "oil";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves Taper held at 8 and reports a level result with Oil but no Wick", async () => {
  isolate(h);
  holdWeapon(h, "taper", MAX_WEAPON_LEVEL);
  holdPassive(h, WRONG_PASSIVE, 1);

  const after = await openChest(h);
  captureStill(h, "held");

  assertUndefined(
    heldWeapon(after, "pyre"),
    "the slot holding Pyre after a chest with Oil held and no Wick (specs/evolutions.md, The recipe)",
  );
  assertEqual(
    heldWeapon(after, "taper")?.level,
    MAX_WEAPON_LEVEL,
    "Taper's level after the chest, a base weapon at its max (specs/evolutions.md, Opening a chest)",
  );
  assertEqual(
    chestResultOf(after).kind,
    "level",
    "the chest's result with Oil at 1, the one item below its max (specs/evolutions.md, Opening a chest)",
  );
});
