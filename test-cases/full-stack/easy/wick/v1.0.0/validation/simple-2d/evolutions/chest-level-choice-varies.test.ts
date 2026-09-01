// Wick — evolutions/chest-level-choice-varies: which held item a chest levels
// is drawn from the game's seeded generator.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Opening a chest"), rule 2: "One held item below
//     its max level ... is chosen uniformly at random from the game's seeded
//     generator and rises by `1`", and the result names it as `item`.
//   - `specs/instrumentation.md` ("A deterministic core"): "The game holds one
//     pseudo-random generator, seeded by `reset` and keeping its whole state in
//     `rngState`, and every random draw comes from it: ... a chest's fallback
//     item"; (`reset`): "`options.seed` seeds the generator".
//   - `specs/evolutions.md` ("The recipe"): Taper evolves only beside Wick, and
//     no Wick is held, so rule 1 never applies and every chest of this point
//     falls to rule 2.
//   - `specs/passives.md`: Brass has `maxLevel` `3`;
//     `specs/progression.md` ("Slots"): `MAX_WEAPON_LEVEL` is `8`. Taper at 3
//     and Brass at 1 are therefore exactly two candidates.
//
// WHAT IS READ. Twenty chests, each opened on a night reset with its own seed
// and posed with the same two candidates: the item each result names. More than
// one distinct item appears across the twenty. A build that always levels the
// first slot, the weapon, or the passive names one item twenty times.
//
// WHY THE NIGHT IS POSED AS IT IS. Exactly two candidates, so the draw has
// something to vary between and the reading is the draw rather than the pool;
// nothing on the field and every driver switch off, so the generator serves the
// chest alone on each night: no spawn, no drop, and no offer draws from it.
//
// TOLERANCE. Twenty independent uniform draws over two candidates land on one
// item with probability 2 × 2^-20, about one in five hundred thousand, so a
// conformant build fails this reading that rarely and a build that never varies
// fails it every time.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import { DEFAULT_SEED } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  openChest,
  type Harness,
} from "../harness";
import { assertResultKind, poseChestNight } from "./chest";

/** The two candidates: a weapon below 8 and a passive below its max. */
const WEAPON = "taper";
const WEAPON_LEVEL = 3;
const PASSIVE = "brass";
const PASSIVE_LEVEL = 1;

/** How many seeds are sampled, each one night with one chest. */
const SEEDS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("levels Taper on some of twenty seeds and Brass on others", async () => {
  const chosen = new Set<string>();
  for (let index = 0; index < SEEDS; index += 1) {
    const seed = DEFAULT_SEED + index;
    poseChestNight(h, seed);
    holdWeapon(h, WEAPON, WEAPON_LEVEL);
    holdPassive(h, PASSIVE, PASSIVE_LEVEL);

    const after = await openChest(h);
    if (index === SEEDS - 1) captureStill(h, "random");
    const result = assertResultKind(
      after,
      "level",
      `the chest on seed ${seed}`,
    );
    if (result.kind !== "level") fail("a level result", result.kind);
    assertEqual(
      result.item === WEAPON || result.item === PASSIVE,
      true,
      `the item leveled on seed ${seed}, one of the two held`,
    );
    chosen.add(result.item);
  }

  assertGreaterThan(
    chosen.size,
    1,
    `distinct items leveled across ${SEEDS} seeds (${[...chosen].join(", ")})`,
  );
});
