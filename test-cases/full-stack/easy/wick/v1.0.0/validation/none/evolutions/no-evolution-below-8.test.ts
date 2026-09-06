// Wick — evolutions/no-evolution-below-8: a base below `MAX_WEAPON_LEVEL` does
// not evolve, whatever passive is held beside it.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("The recipe"): "A base
// weapon is eligible to evolve when all three hold at once: it is held at
// `MAX_WEAPON_LEVEL` (`8`); the passive its recipe names is held, at any level;
// the player opens a chest." Taper at level `7` fails the first condition, so
// rule 1 of "Opening a chest" finds nothing to evolve and the chest falls to
// rule 2 or rule 3: "The result is `{ kind: "level", item, level }`" or
// "`{ kind: "heal" }`". So the chest leaves `taper` in its slot, no evolved
// weapon anywhere in the loadout, and a level or heal result.
//
// WHAT IS NOT PINNED, AND WHY. Rule 2 chooses "One held item below its max
// level ... uniformly at random", and with
// Taper at `7` and Wick at `1` both candidates are below their max, so which
// of the two rises is a draw rather than a figure the specification fixes. The
// check therefore reads what the requirement is about — that the slot still
// holds the BASE weapon and that the result is not an evolution — and reads the
// level result, when that is what the draw gave, against the item it names: the
// item rose by exactly one and the level reported is the level it became. That
// the draw varies at all is `chest-level-choice-varies`.
//
// THE POSE. An isolated night with Taper at level 7 through `setWeapon` and
// Wick at level 1 through `setPassive`, and the chest reached the real way
// through the harness's `openChest`. Nothing else runs on the tick.
//
// TOLERANCE. None: the slot's id, the levels, and the result's kind are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  passiveIn,
  weaponIn,
  type Harness,
} from "../harness";
import { assertNoEvolutionHeld, assertNotEvolved, slotOf } from "./stage";

/** The slot Taper is posed in. */
const SLOT = 0;

/** One below the max, so the first condition of the recipe fails. */
const TAPER_LEVEL = MAX_WEAPON_LEVEL - 1;

/** Wick's level, so the recipe's passive condition holds and the level one does not. */
const WICK_LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves Taper a base weapon at level 7 or 8 and reports a level or heal result", async () => {
  await isolate(h);
  await holdWeapon(h, "taper", TAPER_LEVEL, SLOT);
  await holdPassive(h, "wick", WICK_LEVEL);

  const opened = await openChest(h);
  await captureStill(h, "held");

  const slot = slotOf(opened, SLOT, "after the chest");
  assertEqual(slot.id, "taper", "the weapon in the slot after the chest");
  assertNoEvolutionHeld(opened, "after a chest with Taper at level 7");
  const result = assertNotEvolved(
    opened,
    "a chest with Taper at level 7 and Wick held",
  );
  if (result.kind === "level") {
    assertContains(
      ["taper", "wick"],
      result.item,
      "the item the chest leveled, one of the two below their max",
    );
    const was = result.item === "taper" ? TAPER_LEVEL : WICK_LEVEL;
    assertEqual(
      result.level,
      was + 1,
      `${result.item}'s level after the chest`,
    );
    const now =
      result.item === "taper"
        ? weaponIn(opened, "taper")?.level
        : passiveIn(opened, "wick")?.level;
    assertEqual(
      now,
      result.level,
      `${result.item}'s level as the loadout holds it`,
    );
  }
});
