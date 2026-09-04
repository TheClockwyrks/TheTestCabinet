// evolutions/chest-level-skips-maxed — the chest's level result skips items at
// their max.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Opening a chest"),
// rule 2: "One held item below its max level, a base weapon below
// `MAX_WEAPON_LEVEL` or a passive below its own max, is chosen uniformly at
// random", and rule 1: "A base weapon with no recipe never evolves: at
// `MAX_WEAPON_LEVEL` a chest passes it over, and it is neither evolved nor
// leveled." Taper, Ember, and Pin at 8 without their recipe passives are
// eligible for neither rule — none is below `MAX_WEAPON_LEVEL`, and no recipe
// passive is held — so the one candidate is Brass at 1, below its own max of 3
// (`specs/passives.md`). The draw is over a single candidate whatever the
// seed, so the result is `{ kind: "level", item: "brass", level: 2 }`, Brass
// stands at 2, and the three maxed weapons stand at 8.
//
// WHY THREE MAXED WEAPONS AND TWENTY SEEDS. The rule this point names is the
// one that keeps a maxed item OUT of the draw, and a build whose pool wrongly
// admits maxed items is only visible when the draw actually names one. With a
// single maxed weapon beside Brass such a build names Brass half the time, and
// on any one seed the reading is a coin flip; with three, it names Brass a
// quarter of the time, and the same assertion is made on each of twenty seeds
// laid by `reset` ("a whole number from `0` to `2^32 − 1`",
// `specs/instrumentation.md`), so a build carrying the maxed items in its pool
// escapes with probability `4^−20`. The check stays deterministic: it asserts
// the SAME result on every seed rather than a distribution, because the
// specification leaves the conformant build one candidate to draw from.
//
// WHY THE WORLD IS POSED AS IT IS. Twenty isolated runs, each `reset` with its
// own seed and each holding Taper, Ember, and Pin at `MAX_WEAPON_LEVEL` and
// Brass at 1 and nothing else, every driver switch off, so the tick that
// collects the chest fires nothing and moves nothing. No Wick, Oil, or Mirror
// is held, so no maxed weapon can evolve and the check reads the level rule
// alone; that a maxed weapon beside its recipe passive DOES evolve is
// `evolves-when-eligible`'s point.
//
// THE TOLERANCE. None: a result object and four slot levels are read exactly,
// on each seed.

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

/** The base weapons posed at `MAX_WEAPON_LEVEL`, none with its recipe passive. */
const MAXED = ["taper", "ember", "pin"] as const;

/** How many seeded runs are opened. */
const SEEDS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("levels Brass to 2 and leaves the maxed weapons at 8 on every seed", async () => {
  if (!(BRASS_LEVEL < PASSIVES.brass.maxLevel)) {
    throw new Error("Brass must be posed below its max level");
  }

  for (let seed = 1; seed <= SEEDS; seed += 1) {
    isolate(h, { seed });
    for (const id of MAXED) holdWeapon(h, id, MAX_WEAPON_LEVEL);
    holdPassive(h, "brass", BRASS_LEVEL);

    const after = await openChest(h);
    if (seed === SEEDS) captureStill(h, "skipped");

    assertDeepEqual(
      after.run.chestResult,
      { kind: "level", item: "brass", level: BRASS_LEVEL + 1 },
      `seed ${seed}: the chest's result with Brass the one item below its max (specs/evolutions.md, Opening a chest)`,
    );
    assertEqual(
      heldPassive(after, "brass")?.level,
      BRASS_LEVEL + 1,
      `seed ${seed}: Brass's level after the chest`,
    );
    for (const id of MAXED) {
      assertEqual(
        heldWeapon(after, id)?.level,
        MAX_WEAPON_LEVEL,
        `seed ${seed}: ${id}'s level after the chest, a weapon at \`MAX_WEAPON_LEVEL\` the chest passes over (specs/evolutions.md, Opening a chest)`,
      );
    }
  }
});
