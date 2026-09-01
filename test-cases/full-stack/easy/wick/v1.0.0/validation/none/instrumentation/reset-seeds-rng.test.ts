// Wick — instrumentation/reset-seeds-rng: `reset({ seed })` seeds `rngState`
// from the seed, `reset()` with no seed seeds it from `DEFAULT_SEED` (`1`), and
// two resets with the same seed leave the same `rngState` and draw the same
// spawns.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `reset(options)`):
// "`options.seed` seeds the generator, defaulting to `DEFAULT_SEED` (`1`): a
// whole number from `0` to `2^32 − 1`, which `rngState` equals once the call
// returns"; and "A deterministic core": "Given the same seed, the same sequence
// of operations, and the same number of ticks, the game reaches the same `run`
// and `rngState` every time". specs/enemies.md has the director draw "the spawn
// angle and the type choice ... from the game's seeded generator", so two runs
// from one seed spawn the same enemies at the same points.
//
// WHY THE WORLD IS POSED AS IT IS. The seed is one no other check uses, so a
// build echoing a fixed number fails; the no-argument reset is called by this
// check itself rather than through the harness, which always names a seed. The
// two runs are fresh runs with the director on, run for one second each, so
// the reading is of real spawns and not of a posed enemy.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { DEFAULT_SEED, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  documentedRun,
  startRun,
  type Harness,
} from "../harness";

/** A seed of this check's own. */
const SEED = 20260;

/** Ticks each seeded run is played for: one second, enough for the director to spawn. */
const RUN_TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("seeds rngState from the seed, defaults it, and replays the same spawns", async () => {
  await h.debug.reset({ seed: SEED });
  assertEqual((await h.snapshot()).rngState, SEED, "rngState after reset({ seed })");

  await h.debug.reset();
  assertEqual(
    (await h.snapshot()).rngState,
    DEFAULT_SEED,
    "rngState after reset() with no seed",
  );

  await startRun(h, SEED);
  const first = await h.step(RUN_TICKS);
  await startRun(h, SEED);
  const second = await h.step(RUN_TICKS);
  await captureStill(h, "seeded");

  assertGreaterThan(first.run.enemies.length, 0, "enemies the director spawned");
  assertEqual(second.rngState, first.rngState, "rngState after two seeded runs");
  assertDeepEqual(
    documentedRun(second.run),
    documentedRun(first.run),
    "the run after two seeded runs, the spawns included",
  );
});
