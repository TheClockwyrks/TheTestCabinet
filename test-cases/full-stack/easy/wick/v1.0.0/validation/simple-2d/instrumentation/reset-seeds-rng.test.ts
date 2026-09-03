// instrumentation/reset-seeds-rng — `reset({ seed })` seeds rngState from the
// seed, `reset()` seeds it from DEFAULT_SEED (1), and two resets with one seed
// leave the same rngState and draw the same spawns.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `reset`:
// "`options.seed` seeds the generator, defaulting to `DEFAULT_SEED` (`1`): a
// whole number from `0` to `2^32 − 1`, which `rngState` equals once the call
// returns". "A deterministic core": "Given the same seed, the same sequence of
// operations, and the same number of ticks, the game reaches the same `run`
// and `rngState` every time". specs/enemies.md: a spawn's angle and type are
// "drawn from the game's seeded generator", and "A spawn ... lands on the
// first tick of a run".
//
// THE READ. `rngState` equals the seed at the call, exactly, for a chosen seed
// and for the default. Then two runs from the same seed are started through
// `setScreen("playing")`, each with the director on as a reset leaves it, and
// the moth each first tick spawned is compared point for point: the same seed
// drew the same angle. Determinism over a longer run is
// `seeded-replay-deterministic`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { DEFAULT_SEED } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** A seed no fresh session carries, so the read is of the argument. */
const SEED = 424242;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Reset to `seed`, start a run through the surface, and run its first tick. */
async function firstTickFrom(seed: number): Promise<WickSnapshot> {
  h.reset(seed);
  h.debug.setScreen("playing");
  return h.tick(1);
}

it("seeds rngState from the seed and reproduces the first spawn", async () => {
  h.reset(SEED);
  assertEqual(h.snapshot().rngState, SEED, "rngState after reset({ seed })");
  h.reset();
  assertEqual(h.snapshot().rngState, DEFAULT_SEED, "rngState after reset()");

  const first = await firstTickFrom(SEED);
  const second = await firstTickFrom(SEED);
  captureStill(h, "seeded");

  assertLength(first.run.enemies, 1, "the spawn the first tick of a run lands");
  assertDeepEqual(
    second.run.enemies,
    first.run.enemies,
    "the first spawn of two runs from one seed",
  );
  assertEqual(second.rngState, first.rngState, "rngState after the same tick");
});
