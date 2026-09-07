// evolutions/chest-fallback-level — a chest with nothing eligible levels one
// held item.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Opening a chest"),
// rule 2: "One held item below its max level, a base weapon below
// `MAX_WEAPON_LEVEL` or a passive below its own max, is chosen uniformly at
// random and rises by `1`, exactly as accepting a `+1 level` offer does. The
// result is `{ kind: "level", item, level }`, with `level` the level it
// became." With Taper at 3 and Brass at 1 held, rule 1 finds nothing (Taper
// is below `MAX_WEAPON_LEVEL` and Brass is no weapon), both held items are
// below their maxes — Taper's 8 and Brass's 3 (`specs/passives.md`) — and
// exactly one of them rises by one.
//
// WHAT IS ASSERTED. That the chest levelled ONE of the two by exactly one
// level, and that the result names that item and the level it became. WHICH of
// the two is a uniform draw, so it is read from the result rather than
// predicted, and the item the result did NOT name is
// asserted to stand exactly where it was posed — so a chest that raised both,
// or raised one by two, fails.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Taper at 3 and
// Brass at 1 and nothing else, every driver switch off, so the tick that
// collects the chest fires nothing and moves nothing, and the only change to
// the loadout is the chest's. Brass is the passive because it feeds `armor`
// alone (`specs/passives.md`), which nothing in this scenario reads.
//
// THE TOLERANCE. None: slot levels and a result object are read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { PASSIVES } from "../constants";
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
import { levelResultOf } from "./evolved";

/** The two held items, each below its own max. */
const TAPER_LEVEL = 3;
const BRASS_LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises Taper or Brass by one and reports the item and the level it became", async () => {
  if (!(BRASS_LEVEL < PASSIVES.brass.maxLevel)) {
    throw new Error("Brass must be posed below its max level");
  }

  isolate(h);
  holdWeapon(h, "taper", TAPER_LEVEL);
  holdPassive(h, "brass", BRASS_LEVEL);

  const after = await openChest(h);
  captureStill(h, "leveled");

  const result = levelResultOf(after);
  assertContains(
    ["taper", "brass"],
    result.item,
    "the item the chest levelled, one of the two held below their maxes (specs/evolutions.md, Opening a chest)",
  );

  const taper = heldWeapon(after, "taper")?.level;
  const brass = heldPassive(after, "brass")?.level;
  const raised = result.item === "taper" ? taper : brass;
  const untouched = result.item === "taper" ? brass : taper;
  const posed = result.item === "taper" ? TAPER_LEVEL : BRASS_LEVEL;
  const other = result.item === "taper" ? BRASS_LEVEL : TAPER_LEVEL;

  assertEqual(
    raised,
    posed + 1,
    `${result.item}'s level after the chest, one above the ${posed} it was posed at (specs/evolutions.md, Opening a chest)`,
  );
  assertEqual(
    result.level,
    posed + 1,
    `the level the chest's result reports, the level ${result.item} became (specs/evolutions.md, Opening a chest)`,
  );
  assertEqual(
    untouched,
    other,
    "the level of the item the chest did not name, which one chest leaves as it stands (specs/evolutions.md, Opening a chest)",
  );
});
