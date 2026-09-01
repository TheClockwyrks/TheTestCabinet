// evolutions/chest-level-choice-varies — the chest's levelled item is chosen
// at random.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Opening a chest"),
// rule 2: "One held item below its max level ... is chosen uniformly at random
// from the game's seeded generator and rises by `1`."
// `specs/instrumentation.md` ("A deterministic core"): "The game holds one
// pseudo-random generator, seeded by `reset` ... and every random draw comes
// from it: ... a chest's fallback item", and `reset`'s `options.seed` "seeds
// the generator". So over runs laid with different seeds, the same two-item
// loadout must see the draw land on each of the two items at least once — a
// build that always levels the first slot, the weapon, or the newest item
// makes the same choice under every seed.
//
// WHY TWENTY SEEDS. Each chest is one draw between two candidates, so a
// conformant build shows one item on all twenty seeds with probability
// `2 × 2^−20`, about two in a million, while a build whose choice is not a
// draw at all shows one item every time. Seeds `1` through `SEEDS` are used
// because `reset` accepts "a whole number from `0` to `2^32 − 1`".
//
// WHY THE WORLD IS POSED AS IT IS. Twenty isolated runs, each `reset` with its
// own seed and each holding Taper at 3 and Brass at 1 and nothing else, every
// driver switch off. Each run collects one chest, so each is one draw from the
// generator as that seed laid it, and no earlier scenario's draws carry into
// it. Both items are below their maxes — Taper's 8 and Brass's 3
// (`specs/passives.md`) — so the pool the draw is made from is the same two
// items in every run, and rule 1 finds nothing to evolve with no recipe
// passive held.
//
// THE TOLERANCE. None: the twenty reported items are compared as a set.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
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

/** How many seeded runs are opened. */
const SEEDS = 20;

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

it("levels Taper on some of twenty seeds and Brass on others", async () => {
  const chosen: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    isolate(h, { seed });
    holdWeapon(h, "taper", TAPER_LEVEL);
    holdPassive(h, "brass", BRASS_LEVEL);
    const after = await openChest(h);
    chosen.push(levelResultOf(after).item);
  }
  captureStill(h, "random");

  assertEqual(
    chosen.length,
    SEEDS,
    "the chests opened, one per seed (specs/instrumentation.md, reset)",
  );
  assertContains(
    chosen,
    "taper",
    `the items ${SEEDS} seeded chests levelled, which must include the weapon (specs/evolutions.md, Opening a chest)`,
  );
  assertContains(
    chosen,
    "brass",
    `the items ${SEEDS} seeded chests levelled, which must include the passive (specs/evolutions.md, Opening a chest)`,
  );
});
