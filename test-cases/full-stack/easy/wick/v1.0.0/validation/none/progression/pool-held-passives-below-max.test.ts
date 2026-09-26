// progression/pool-held-passives-below-max — the pool offers +1 level on held
// passives below max.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The candidate pool"):
// the pool holds "every held passive below its max level ... as a `+1 level`
// offer", and "a passive levels up to its own max level, given in
// `specs/passives.md`". `PASSIVES` there gives Brass a max of `3` and Lure a max
// of `5`. specs/instrumentation.md reports the pool "computed from the slots as
// they stand". So a Brass at `2` and a Lure at `4`, each one level under its own
// max, are both in the pool.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held
// and nothing alive, and exactly two passives held. The two are chosen for
// their different maxima — Brass caps at `3` and Lure at `5` — and each is posed
// one level short of its own, so a build that compares every passive against one
// shared ceiling fails on one of them.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { PASSIVES } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** Brass, one level under its own max of 3. */
const BRASS_LEVEL = PASSIVES.brass.maxLevel - 1;

/** Lure, one level under its own max of 5. */
const LURE_LEVEL = PASSIVES.lure.maxLevel - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds both held passives below their own maxima", async () => {
  await isolate(h);
  await holdPassive(h, "brass", BRASS_LEVEL);
  await holdPassive(h, "lure", LURE_LEVEL);

  const overlay = await openLevelUp(h);
  await captureStill(h, "pool");

  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertContains(overlay.run.pool, "brass", "the pool, for the Brass at 2");
  assertContains(overlay.run.pool, "lure", "the pool, for the Lure at 4");
});
