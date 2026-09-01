// evolutions/chest-level-skips-maxed — the chest's level result skips items at
// their max.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Opening a chest"),
// rule 2: "One held item below its max level, a base weapon below
// `MAX_WEAPON_LEVEL` or a passive below its own max, is chosen uniformly at
// random", and rule 1: "A base weapon with no recipe never evolves: at
// `MAX_WEAPON_LEVEL` a chest passes it over, and it is neither evolved nor
// leveled." Taper at 8 without Wick is eligible for neither rule — it is not
// below `MAX_WEAPON_LEVEL`, and its recipe passive is not held — so the one
// candidate is Brass at 1, below its own max of 3 (`specs/passives.md`). The
// draw is over a single candidate whatever the seed, so the result is
// `{ kind: "level", item: "brass", level: 2 }` and Taper is left at 8.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Taper at 8 and
// Brass at 1 and nothing else, every driver switch off, so the tick that
// collects the chest fires nothing and moves nothing. No Wick is held, so the
// maxed weapon cannot evolve and the check reads the level rule alone; that a
// maxed weapon beside its recipe passive DOES evolve is
// `evolves-when-eligible`'s point.
//
// THE TOLERANCE. None: a result object and two slot levels are read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { MAX_WEAPON_LEVEL, PASSIVES } from "../constants";
import {
  captureStill,
  createHarness,
  heldPassive,
  heldWeapon,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  type Harness,
} from "../harness";

/** Brass, the one item below its max: level 1 of a max of 3. */
const BRASS_LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("levels Brass to 2 and leaves the maxed Taper at 8", async () => {
  if (!(BRASS_LEVEL < PASSIVES.brass.maxLevel)) {
    throw new Error("Brass must be posed below its max level");
  }

  isolate(h);
  holdWeapon(h, "taper", MAX_WEAPON_LEVEL);
  holdPassive(h, "brass", BRASS_LEVEL);

  const after = await openChest(h);
  captureStill(h, "skipped");

  assertDeepEqual(
    after.run.chestResult,
    { kind: "level", item: "brass", level: BRASS_LEVEL + 1 },
    "the chest's result with Brass the one item below its max (specs/evolutions.md, Opening a chest)",
  );
  assertEqual(
    heldPassive(after, "brass")?.level,
    BRASS_LEVEL + 1,
    "Brass's level after the chest",
  );
  assertEqual(
    heldWeapon(after, "taper")?.level,
    MAX_WEAPON_LEVEL,
    "Taper's level after the chest, a weapon at `MAX_WEAPON_LEVEL` the chest passes over (specs/evolutions.md, Opening a chest)",
  );
});
