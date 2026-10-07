// Wick — progression/pool-held-passives-below-max: a held passive below its
// own max level is a candidate.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The
// candidate pool": the pool holds "every held passive below its max level ...
// as a `+1 level` offer", and "a passive levels up to its own max level, given
// in `specs/passives.md`". That file's table gives Brass a max level of `3` and
// Lure a max level of `5`. `specs/instrumentation.md` reports the pool as the
// run's `pool` on `levelup`.
//
// THE POSE. An isolated `playing` run holding two passives and nothing else:
// Brass at `2`, one below its max of `3`, and Lure at `4`, one below its max of
// `5`, so the rule is read against two different maxima. Every driver switch is
// off and the world is empty. The overlay is opened by the real path, one
// queued level-up and one `playing` tick.
//
// THE TOLERANCE. Exact: membership of two ids in a list of ids.

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

/** One level below each passive's own max, which differ from each other. */
const BRASS_LEVEL = PASSIVES.brass.maxLevel - 1;
const LURE_LEVEL = PASSIVES.lure.maxLevel - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds brass and lure in the pool while both are below their own maxima", async () => {
  isolate(h);
  holdPassive(h, "brass", BRASS_LEVEL);
  holdPassive(h, "lure", LURE_LEVEL);

  const overlay = await openLevelUp(h, 1);
  await h.frameDraw();
  captureStill(h, "pool");

  assertEqual(overlay.screen, "levelup", "screen after the opening tick");
  assertContains(
    overlay.run.pool,
    "brass",
    `run.pool with Brass held at ${BRASS_LEVEL} of ${PASSIVES.brass.maxLevel}`,
  );
  assertContains(
    overlay.run.pool,
    "lure",
    `run.pool with Lure held at ${LURE_LEVEL} of ${PASSIVES.lure.maxLevel}`,
  );
});
