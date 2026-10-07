// runs/completion-at-or-past-the-target — the completion test asks whether a
// tally has REACHED the target, not whether it landed on it.
//
// THE RULE. "After the rises, if every set's tally HAS REACHED the challenge's
// `target`, the run completes" (`specs/simulation.md`, Completion and metrics).
// A tally does not have to arrive one at a time: "An accepted constellation is
// consumed whole, and the set's tally rises by `1` for a plain product and BY `k`
// FOR A REPEATING ONE" (`specs/sigils.md`, Rises and sets), where `k` is how many
// chained copies of the placed pattern the accepted constellation held,
// `k >= REPEAT_MIN` (`2`). So a tally can step over the target, and a build that
// tests for equality would run on forever past a machine that had already
// delivered enough.
//
// THE CONFIGURATION is the repeating challenge, its set placed so its footprint
// runs east from `(-2, 0)`, and a chain of FIVE `luna` on `(-2, 0)` through
// `(2, 0)` joined consecutively by weight-`1` filaments — exactly `k = 5` copies
// of the placed pattern translated by the placed repeat vector, which is what
// `specs/sigils.md` accepts. The tally is posed at `2` beforehand, so the
// delivery takes it from `2` to `7` against a `target` of `6`: past the figure
// rather than onto it, and past it by a margin no rounding explains.
//
// THE VERDICT. The tally is `7`, which is greater than the target, and the run is
// `complete` at that boundary with its metrics recorded.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLength,
  assertNotNull,
} from "../assert";
import { CONSTELLATION_TARGET, REPEAT_MIN } from "../constants";
import { at } from "../field";
import { setPart, solution } from "../formats";
import { REPEATING } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openRun,
  spawnConstellation,
  tallyOf,
  type Harness,
} from "../harness";

/** Where the repeating set is placed: its footprint runs east from here. */
const SET_AT = at(-2, 0);

/** How many chained copies the delivery holds. */
const COPIES = 5;

/** The tally the check starts from, so the delivery lands past the target. */
const OPENING_TALLY = 2;

/** The whole machine: one repeating set. */
const ONE_SET = solution([setPart(0, SET_AT.q, SET_AT.r)]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("completes on a repeating delivery that carries the tally past the target", async () => {
  await openRun(h, { challenge: REPEATING, machine: ONE_SET });
  assertEqual(
    (await h.snapshot()).challenge?.target,
    CONSTELLATION_TARGET,
    "the posed challenge asks for CONSTELLATION_TARGET",
  );
  assertGreaterThanOrEqual(
    COPIES,
    REPEAT_MIN,
    "a repeating set accepts k >= REPEAT_MIN chained copies",
  );

  await h.debug.setTally(0, OPENING_TALLY);

  // Copy `i` of the placed pattern, translated by `i` times the placed repeat
  // vector `(1, 0)`, consecutive copies joined by the placed link filament.
  const chain = Array.from({ length: COPIES }, (_, i) => ({
    hex: at(SET_AT.q + i, SET_AT.r),
    type: "luna" as const,
  }));
  const links = Array.from({ length: COPIES - 1 }, (_, i) => ({
    a: i,
    b: i + 1,
    weight: 1,
  }));
  await spawnConstellation(h, chain, links);

  const before = await h.snapshot();
  assertLength(
    before.sim?.motes ?? [],
    COPIES,
    "the chain is the whole of the field, so the set has exactly k copies to read",
  );
  assertEqual(
    tallyOf(before, 0),
    OPENING_TALLY,
    "the tally stands below the target before the cycle runs",
  );
  assertEqual(
    before.sim?.status,
    "running",
    "the run is running before the delivery",
  );

  await captureReplay(h, "overshoot", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertNotNull(
    after.sim,
    "the run is still reported at the completing boundary",
  );
  assertEqual(
    tallyOf(after, 0),
    OPENING_TALLY + COPIES,
    "a repeating set's tally rises by k, so the delivery lands on 7",
  );
  assertGreaterThan(
    tallyOf(after, 0) ?? -1,
    CONSTELLATION_TARGET,
    "the tally passed the target rather than equalling it",
  );
  assertEqual(
    after.sim?.status,
    "complete",
    "a tally that has reached the target completes the run, equal to it or past it",
  );
  assertNotNull(
    after.sim?.metrics ?? null,
    "the metrics are recorded when the run completes",
  );
});
