// Wick — evolutions/chest-level-skips-maxed: a chest's level result passes over
// an item already at its max.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Opening a chest"),
// rule 2: "One held item below its max level, a base weapon below
// `MAX_WEAPON_LEVEL` or a passive below its own max, is chosen ... and rises by
// `1`". With Taper, Ember, and Pin at `MAX_WEAPON_LEVEL` (`8`) and none of
// their recipe passives held, rule 1 finds nothing to evolve — "the passive its
// recipe names is held" fails — and a maxed weapon is not a candidate for rule
// 2 either, since it is not below its max. Brass at level `1` is below its max
// of `3` (`specs/passives.md`), so it is the only candidate and a uniform draw
// over one candidate is that candidate: the result is
// `{ kind: "level", item: "brass", level: 2 }` and every maxed weapon still
// reads `8`.
//
// WHY THREE MAXED WEAPONS AND TWENTY CHESTS. The rule this point names is the
// one that keeps a maxed item OUT of the draw, and a build whose pool wrongly
// admits maxed items is only caught on a draw that actually names one. Beside a
// single maxed weapon such a build names Brass half the time, so one chest is a
// coin flip; beside three it names Brass a quarter of the time, and the same
// assertions are made on each of twenty chests, so it escapes with probability
// `4^−20`. The specification leaves a conformant build ONE candidate, so the
// SAME result is asserted on every chest.
//
// THE POSE. Twenty chests on one isolated night, each with Taper, Ember, and
// Pin at level 8 and Brass posed back to level 1, none of Wick, Oil, or Mirror
// held, each chest reached the real way through the harness's `openChest` and
// its overlay left through `setScreen("playing")`. Nothing is posed for the
// draw itself.
//
// TOLERANCE. None: the result's three fields and the four levels are exact, on
// every chest.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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
import { chestOutcome, closeChest } from "./stage";

/** Brass's posed level: below its max of `3`, and the only candidate. */
const BRASS_LEVEL = 1;

/** The base weapons posed at `MAX_WEAPON_LEVEL`, none beside its recipe passive. */
const MAXED = ["taper", "ember", "pin"] as const;

/** How many chests are opened. */
const CHESTS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("levels Brass to 2 and leaves the maxed weapons at 8 on every chest", async () => {
  await isolate(h);
  for (let i = 0; i < MAXED.length; i += 1) {
    await holdWeapon(h, MAXED[i], MAX_WEAPON_LEVEL, i);
  }
  for (let chest = 1; chest <= CHESTS; chest += 1) {
    await holdPassive(h, "brass", BRASS_LEVEL, 0);

    const opened = await openChest(h);
    if (chest === CHESTS) await captureStill(h, "skipped");

    const where = `chest ${chest}: the chest with three maxed weapons and Brass 1`;
    const result = chestOutcome(opened, where);
    assertEqual(result.kind, "level", `${where}: the chest result's kind`);
    if (result.kind === "level") {
      assertEqual(result.item, "brass", `${where}: the item the chest leveled`);
      assertEqual(
        result.level,
        BRASS_LEVEL + 1,
        `${where}: the level Brass became`,
      );
    }
    assertEqual(
      passiveIn(opened, "brass")?.level,
      BRASS_LEVEL + 1,
      `${where}: Brass's level after the chest`,
    );
    for (const id of MAXED) {
      assertEqual(
        weaponIn(opened, id)?.level,
        MAX_WEAPON_LEVEL,
        `${where}: ${id}'s level after the chest`,
      );
    }
    await closeChest(h, opened);
  }
});
