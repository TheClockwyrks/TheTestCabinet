// Wick — evolutions/chest-fallback-level: a chest with nothing eligible levels
// one held item and reports the level it became.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Opening a chest"), rule 2: "One held item below
//     its max level, a base weapon below `MAX_WEAPON_LEVEL` or a passive below
//     its own max, is chosen uniformly at random from the game's seeded
//     generator and rises by `1`, exactly as accepting a `+1 level` offer does.
//     The result is `{ kind: "level", item, level }`, with `level` the level it
//     became."
//   - `specs/evolutions.md` ("The recipe"): an evolution needs a base at
//     `MAX_WEAPON_LEVEL` beside its recipe passive; Taper at level 3 with no
//     Wick held meets neither, so rule 1 does not apply and rule 2 decides.
//   - `specs/passives.md`: Brass has `maxLevel` `3`, so Brass at level 1 is a
//     candidate; `specs/progression.md` ("Slots"): `MAX_WEAPON_LEVEL` is `8`,
//     so Taper at level 3 is one too.
//
// WHAT IS READ. After the collecting tick: `chestResult` reads
// `{ kind: "level", item, level }` whose `item` is one of the two held items;
// that item's slot reads exactly one level above where it was posed; the
// result's `level` is that same level; and the other item is untouched. Which
// of the two rises is the generator's, and this point decides the rule rather
// than the draw.
//
// WHY THE NIGHT IS POSED AS IT IS. One weapon and one passive, both below their
// maxima and neither forming a recipe, so rule 1 cannot apply and rule 3 cannot
// be reached; nothing on the field and every driver switch off, so no kill, no
// gem, and no level-up can raise an item on the collecting tick.
//
// TOLERANCE. None: an id and whole levels.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, fail } from "../assert";
import { PASSIVES } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  openChest,
  passiveSlot,
  weaponSlot,
  type Harness,
} from "../harness";
import { assertResultKind, poseChestNight } from "./chest";

/** The weapon held, below `MAX_WEAPON_LEVEL` and forming no recipe. */
const WEAPON = "taper";
const WEAPON_LEVEL = 3;

/** The passive held, below its own max and naming no held weapon's recipe. */
const PASSIVE = "brass";
const PASSIVE_LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises one of Taper and Brass by one level and reports the level it became", async () => {
  assertEqual(
    PASSIVE_LEVEL < PASSIVES[PASSIVE].maxLevel,
    true,
    "whether the posed Brass level is below its max",
  );
  poseChestNight(h);
  holdWeapon(h, WEAPON, WEAPON_LEVEL);
  holdPassive(h, PASSIVE, PASSIVE_LEVEL);

  const after = await openChest(h);
  captureStill(h, "leveled");

  const result = assertResultKind(
    after,
    "level",
    "the chest with nothing eligible",
  );
  if (result.kind !== "level") fail("a level result", result.kind);
  assertContains(
    [WEAPON, PASSIVE],
    result.item,
    "the item the chest leveled, one of the two held",
  );

  const weapon = after.run.weapons[weaponSlot(after, WEAPON)];
  const passive = after.run.passives[passiveSlot(after, PASSIVE)];
  const raised = result.item === WEAPON ? WEAPON_LEVEL + 1 : WEAPON_LEVEL;
  const passiveRaised =
    result.item === PASSIVE ? PASSIVE_LEVEL + 1 : PASSIVE_LEVEL;
  assertEqual(weapon?.level, raised, "Taper's level after the chest");
  assertEqual(passive?.level, passiveRaised, "Brass's level after the chest");
  assertEqual(
    result.level,
    result.item === WEAPON ? raised : passiveRaised,
    "the result's level against the level the item became",
  );
});
