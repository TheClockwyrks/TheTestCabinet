// evolutions/chest-level-choice-varies — the chest's levelled item is chosen
// at random.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Opening a chest"),
// rule 2: "One held item below its max level ... is chosen uniformly at random
// and rises by `1`." So over thirty chests opened over the same two-item
// loadout, the item leveled takes at least two distinct values — a build that
// always levels the first slot, the weapon, or the newest item makes the same
// choice every time.
//
// WHY THIRTY CHESTS. Each chest is one draw between two candidates, so a
// conformant build shows one item on all thirty with probability `2 × 2^−30`,
// under two in a thousand million, while a build whose choice is not a draw at
// all shows one item every time. Nothing is posed for the draw itself; a
// posed item is `instrumentation/set-next-chest-item`'s.
//
// WHY THE WORLD IS POSED AS IT IS. Thirty isolated runs, each holding Taper at
// 3 and Brass at 1 and nothing else, every driver switch off. Each run
// collects one chest, so each is one draw over the same two candidates. Both
// items are below their maxes — Taper's 8 and Brass's 3
// (`specs/passives.md`) — so the pool the draw is made from is the same two
// items in every run, and rule 1 finds nothing to evolve with no recipe
// passive held.
//
// THE TOLERANCE. None: the thirty reported items are counted as a set.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  type Harness,
} from "../harness";
import { levelResultOf } from "./evolved";

/** How many chests are opened. */
const CHESTS = 30;

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

it("levels more than one distinct item across thirty chests", async () => {
  const chosen: string[] = [];
  for (let chest = 1; chest <= CHESTS; chest += 1) {
    isolate(h);
    holdWeapon(h, "taper", TAPER_LEVEL);
    holdPassive(h, "brass", BRASS_LEVEL);
    const after = await openChest(h);
    chosen.push(levelResultOf(after).item);
  }
  captureStill(h, "random");

  assertEqual(chosen.length, CHESTS, "the chests opened, one per run");
  for (const [index, item] of chosen.entries()) {
    assertContains(
      ["taper", "brass"],
      item,
      `the item chest ${index + 1} levelled, one of the two held (specs/evolutions.md, Opening a chest)`,
    );
  }
  assertGreaterThan(
    new Set(chosen).size,
    1,
    `distinct items ${CHESTS} chests levelled (got ${chosen.join(", ")})`,
  );
});
