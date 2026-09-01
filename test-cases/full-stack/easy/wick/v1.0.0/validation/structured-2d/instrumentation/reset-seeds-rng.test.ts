// Wick — instrumentation/reset-seeds-rng: `reset({ seed })` seeds the
// generator from the seed, `reset()` from `DEFAULT_SEED`, and a run from each
// draws the same spawns.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `reset(options)`: "`options.seed` seeds the generator, defaulting to
// `DEFAULT_SEED` (`1`): a whole number from `0` to `2^32 − 1`, which
// `rngState` equals once the call returns". So the read after the call is the
// seed itself, exact. "A deterministic core": "Given the same seed, the same
// sequence of operations, and the same number of ticks, the game reaches the
// same `run` and `rngState` every time" — the first director spawn of a fresh
// run draws its type and angle from the generator (`specs/enemies.md`, "The
// spawn ring"), so two fresh runs from one seed put the same moth at the same
// point on tick 1.
//
// THE DRIVE. A fresh run through `setScreen("playing")`, every switch on, and
// one tick: "A spawn therefore lands on the first tick of a run". The enemy is
// read as `type`, `x`, `y`, exact, since both runs integrate nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { DEFAULT_SEED } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  freshRun,
  type Harness,
} from "../harness";

/** A seed apart from the default, so the two reads are told apart. */
const SEED = 12345;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The first spawn of a fresh run from `seed`: its type and where it landed. */
async function firstSpawn(
  seed: number,
): Promise<{ type: string; x: number; y: number }> {
  freshRun(h, seed);
  const first = await advanceTicks(h, 1);
  assertLength(
    first.run.enemies,
    1,
    `the first tick's spawn from seed ${seed}`,
  );
  const [enemy] = first.run.enemies;
  return { type: enemy.type, x: enemy.x, y: enemy.y };
}

it("seeds rngState from the seed, DEFAULT_SEED without one, and replays the first spawn", async () => {
  h.reset(SEED);
  assertEqual(h.snapshot().rngState, SEED, "rngState after reset({ seed })");
  h.reset();
  assertEqual(
    h.snapshot().rngState,
    DEFAULT_SEED,
    "rngState after reset() with no seed",
  );
  h.reset(DEFAULT_SEED);
  assertEqual(
    h.snapshot().rngState,
    DEFAULT_SEED,
    "rngState after reset({ seed: DEFAULT_SEED })",
  );

  const once = await firstSpawn(SEED);
  const again = await firstSpawn(SEED);
  await h.frameDraw();
  captureStill(h, "seeded");
  assertDeepEqual(
    again,
    once,
    "the first spawn of two fresh runs from one seed",
  );
});
