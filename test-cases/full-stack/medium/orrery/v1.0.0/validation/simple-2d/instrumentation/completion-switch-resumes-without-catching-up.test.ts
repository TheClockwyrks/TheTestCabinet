// instrumentation/completion-switch-resumes-without-catching-up — the switch turned
// back on completes at the NEXT boundary, and books that boundary's figures.
//
// THE RULE. "A gate changes only what it names. Opening one again resumes that
// faculty from the next cycle onward, with no catching up for the cycles it missed"
// (`specs/instrumentation.md`, The switch and the gates). The faculty here is the
// completion check itself, whose two columns are the same table's: off, "the
// completion check does not fire. The run carries on past a satisfied target"; on,
// "A boundary at which every set's tally has reached the challenge's `target`
// completes the run, records the metrics". What the metrics hold is
// `specs/simulation.md`'s: `cycles` is "`sim.cycle + 1` at the completing boundary",
// and `area` "the size of the area bank" as it stands there.
//
// WHY THE CYCLE COUNT IS THE READING. Several boundaries pass with the target
// already satisfied and the switch off. If the check were catching up, it would
// complete on a boundary it had already gone past and record that boundary's
// `cycles` — a figure smaller than the one the run is actually on. So the check
// reads the metric against the cycle the run completed at, and against the cycle
// the FIRST satisfied boundary sat at, and requires the later one.
//
// THE POSE is `First Light`, Extra 1 of `specs/challenges.md`, with a machine of one
// set: the target is reached by a delivery onto that set, and the boundaries after
// it are ordinary boundaries the run crosses with nothing else able to end it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertNull,
} from "../assert";
import { CONSTELLATION_TARGET } from "../constants";
import { EAST } from "../fixtures";
import {
  advanceCycles,
  allowCompletion,
  captureReplay,
  createHarness,
  placeSet,
  spawnMote,
  tallyOf,
  type Harness,
} from "../harness";

/** `First Light` is Extra 1, whose one product is a lone `sol`. */
const EXTRA_INDEX = 0;

/** Boundaries the satisfied run crosses with the switch still off. */
const MISSED = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("completes at the first boundary after the switch returns, not at the ones it missed", async () => {
  await h.debug.reset();
  await h.debug.openChallenge("extras", EXTRA_INDEX);
  await h.debug.clearMachine();
  await placeSet(h, 0, EAST);
  await h.debug.setCompletion(false);
  await h.debug.startRun();
  await h.debug.clearMotes();

  // The boundary that reaches the target, crossed with the switch off.
  await h.debug.setTally(0, CONSTELLATION_TARGET - 1);
  await spawnMote(h, EAST, "sol");
  await advanceCycles(h, 1);

  const satisfied = await h.snapshot();
  assertEqual(
    tallyOf(satisfied, 0),
    CONSTELLATION_TARGET,
    "the target is satisfied from this boundary onward",
  );
  assertEqual(
    satisfied.sim?.status,
    "running",
    "and the switch was off, so it did not complete there",
  );

  // Several more satisfied boundaries pass, still off.
  await advanceCycles(h, MISSED);
  const missed = await h.snapshot();
  assertEqual(
    missed.sim?.status,
    "running",
    "nor at any of the satisfied boundaries after it",
  );
  assertEqual(
    missed.sim?.cycle,
    (satisfied.sim?.cycle ?? -1) + MISSED,
    "and the run carried on across them",
  );
  assertNull(missed.sim?.metrics ?? null, "recording nothing");

  // The switch returns, and the next boundary is the one that completes.
  await allowCompletion(h);
  const armed = await h.snapshot();
  assertEqual(armed.completion, true, "the completion switch is on again");
  assertEqual(
    armed.sim?.status,
    "running",
    "and turning it on completes nothing by itself: a boundary does that",
  );

  await captureReplay(h, "resumed", () => advanceCycles(h, 1));

  const completed = await h.snapshot();
  assertNotNull(completed.sim, "the run is still reported at the boundary");
  assertEqual(
    completed.sim?.status,
    "complete",
    "the first boundary after the switch returned completes the run",
  );
  const metrics = completed.sim?.metrics ?? null;
  assertNotNull(metrics, "and records the metrics that boundary holds");
  assertEqual(
    metrics?.cycles,
    (completed.sim?.cycle ?? -1) + 1,
    "cycles is sim.cycle + 1 at the boundary it completed at",
  );
  assertGreaterThan(
    metrics?.cycles ?? -1,
    (satisfied.sim?.cycle ?? -1) + 1,
    "which is past the boundaries it missed: there is no catching up for them",
  );
  assertEqual(
    metrics?.area,
    completed.sim?.area,
    "and area is the area bank as that boundary left it",
  );
});
