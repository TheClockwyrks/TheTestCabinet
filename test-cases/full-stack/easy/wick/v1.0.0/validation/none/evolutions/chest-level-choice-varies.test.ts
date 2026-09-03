// Wick — evolutions/chest-level-choice-varies: the item a chest levels is drawn
// at random, so it is not the same one every run.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Opening a chest"),
// rule 2: "One held item below its max level ... is chosen uniformly at random
// from the game's seeded generator". `specs/instrumentation.md` ("A
// deterministic core"): "The game holds one pseudo-random generator, seeded by
// `reset` ... and every random draw comes from it: ... a chest's fallback item",
// and "Given the same seed, the same sequence of operations, and the same
// number of ticks, the game reaches the same `run` ... every time." So one seed
// decides one item, and over `SEEDS` (`20`) different seeds a uniform draw over
// two candidates lands on each of them: a build that always levels the same
// item has not drawn at all.
//
// THE POSE. Twenty runs, each an isolated night reset from its own seed with
// Taper at level 3 and Brass at level 1 held — the pair of
// `chest-fallback-level`, both below their max and nothing eligible to evolve —
// and a chest reached the real way through the harness's `openChest`. The item
// each chest named is collected and the twenty are read together.
//
// TOLERANCE. None on the reading: both ids must appear. The bound is the number
// of seeds rather than a rate, so a fair draw fails here only once in `2^19`
// runs.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  type Harness,
} from "../harness";
import { chestOutcome } from "./stage";

/** How many different seeds are drawn from, as the review item states. */
const SEEDS = 20;

/** Taper's posed level: below `MAX_WEAPON_LEVEL`, so nothing is eligible to evolve. */
const TAPER_LEVEL = 3;

/** Brass's posed level: below its max of `3`. */
const BRASS_LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("levels Taper on some of twenty seeds and Brass on others", async () => {
  const chosen: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    await isolate(h, { seed });
    await holdWeapon(h, "taper", TAPER_LEVEL, 0);
    await holdPassive(h, "brass", BRASS_LEVEL, 0);
    const opened = await openChest(h);
    const result = chestOutcome(opened, `the chest opened from seed ${seed}`);
    assertEqual(
      result.kind,
      "level",
      `the chest result's kind from seed ${seed}`,
    );
    if (result.kind === "level") chosen.push(result.item);
  }
  await captureStill(h, "random");

  assertEqual(chosen.length, SEEDS, "chests opened, one per seed");
  assertTrue(
    chosen.includes("taper"),
    `Taper leveled by at least one of the ${SEEDS} seeds (got ${chosen.join(", ")})`,
  );
  assertTrue(
    chosen.includes("brass"),
    `Brass leveled by at least one of the ${SEEDS} seeds (got ${chosen.join(", ")})`,
  );
});
