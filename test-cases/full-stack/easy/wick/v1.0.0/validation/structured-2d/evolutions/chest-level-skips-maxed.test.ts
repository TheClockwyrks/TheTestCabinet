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
// (`specs/passives.md`). The draw is over a single candidate, so the result
// is `{ kind: "level", item: "brass", level: 2 }`, Brass stands at 2, and the
// three maxed weapons stand at 8.
//
// WHY THREE MAXED WEAPONS AND TWENTY CHESTS. The rule this point names is the
// one that keeps a maxed item OUT of the draw, and a build whose pool wrongly
// admits maxed items is only visible when the draw actually names one. With a
// single maxed weapon beside Brass such a build names Brass half the time, and
// on any one chest the reading is a coin flip; with three, it names Brass a
// quarter of the time, and the same assertion is made on each of twenty
// chests, so a build carrying the maxed items in its pool escapes with
// probability `4^−20`. The check asserts the SAME result on every chest
// rather than a distribution, because the specification leaves the conformant
// build one candidate to draw from.
//
// WHY THE WORLD IS POSED AS IT IS. Twenty isolated runs, each `reset` afresh
// and each holding Taper, Ember, and Pin at `MAX_WEAPON_LEVEL` and
// Brass at 1 and nothing else, every driver switch off, so the tick that
// collects the chest fires nothing and moves nothing. No Wick, Oil, or Mirror
// is held, so no maxed weapon can evolve and the check reads the level rule
// alone; that a maxed weapon beside its recipe passive DOES evolve is
// `evolves-when-eligible`'s point.
//
// THE TOLERANCE. None: a result object and four slot levels are read exactly,
// on each chest.

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

/** How many runs are opened, one chest each. */
const CHESTS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("levels Brass to 2 and leaves the maxed weapons at 8 on every chest", async () => {
  if (!(BRASS_LEVEL < PASSIVES.brass.maxLevel)) {
    throw new Error("Brass must be posed below its max level");
  }

  for (let chest = 1; chest <= CHESTS; chest += 1) {
    isolate(h);
    for (const id of MAXED) holdWeapon(h, id, MAX_WEAPON_LEVEL);
    holdPassive(h, "brass", BRASS_LEVEL);

    const after = await openChest(h);
    if (chest === CHESTS) captureStill(h, "skipped");

    assertDeepEqual(
      after.run.chestResult,
      { kind: "level", item: "brass", level: BRASS_LEVEL + 1 },
      `chest ${chest}: the chest's result with Brass the one item below its max (specs/evolutions.md, Opening a chest)`,
    );
    assertEqual(
      heldPassive(after, "brass")?.level,
      BRASS_LEVEL + 1,
      `chest ${chest}: Brass's level after the chest`,
    );
    for (const id of MAXED) {
      assertEqual(
        heldWeapon(after, id)?.level,
        MAX_WEAPON_LEVEL,
        `chest ${chest}: ${id}'s level after the chest, a weapon at \`MAX_WEAPON_LEVEL\` the chest passes over (specs/evolutions.md, Opening a chest)`,
      );
    }
  }
});
