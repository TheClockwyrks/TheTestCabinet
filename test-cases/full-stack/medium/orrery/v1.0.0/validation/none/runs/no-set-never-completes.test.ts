// runs/no-set-never-completes — a machine with nowhere to deliver runs forever.
//
// THE RULE is one sentence, and it is there to close the hole the sentence before
// it opens: "After the rises, if every set's tally has reached the challenge's
// `target`, the run completes ... A RUN WHOSE MACHINE HOLDS NO SET NEVER
// COMPLETES" (`specs/simulation.md`, Completion and metrics). Read as a quantifier
// over an empty machine, "every set's tally has reached the target" is vacuously
// true, and a build that tests it that way finishes a challenge the moment it is
// started. The tallies are a figure of the CHALLENGE rather than of the machine —
// the snapshot carries them "one entry per product" (`specs/instrumentation.md`)
// — so the emptiness the rule is about is the emptiness of the FIELD.
//
// THE CONFIGURATION. One arm on the field and no set anywhere, on a challenge
// asking for `CONSTELLATION_TARGET` of its one product, with that product's tally
// posed AT the target through `setTally`. That is the hardest case the rule has
// to hold in: every number the completion test could read says finished, and the
// one thing that is missing is the set. The check reads the machine back and
// asserts that no `set` is on it, so the pose is the pose the rule names.
//
// THE VERDICT. Twelve cycles later — a dozen boundaries, each of which is a
// chance to complete — the run is still `running`, `sim.cycle` is `12`, and no
// metrics have been recorded. A run that completed at any of those boundaries
// would have frozen there, so the cycle counter alone would catch it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { CONSTELLATION_TARGET } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openRun,
  partsOfKind,
  tallyOf,
  type Harness,
} from "../harness";

/** The whole machine: one arm, resting on a blank tape, and no set at all. */
const NO_SET = solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [])]);

/** How many boundaries the run is given to complete at, and must not. */
const CYCLES = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("never completes, however many cycles it runs, while the machine holds no set", async () => {
  await openRun(h, { challenge: BARE, machine: NO_SET });
  await h.debug.setTally(0, CONSTELLATION_TARGET);

  const before = await h.snapshot();
  assertLength(
    partsOfKind(before, "set"),
    0,
    "the machine holds no set, which is the whole of the configuration",
  );
  assertEqual(
    tallyOf(before, 0),
    CONSTELLATION_TARGET,
    "the product's tally stands at the target, so nothing else holds the run open",
  );
  assertEqual(
    before.challenge?.target,
    CONSTELLATION_TARGET,
    "the posed challenge asks for CONSTELLATION_TARGET",
  );
  assertEqual(
    before.sim?.status,
    "running",
    "the run is live before the cycles",
  );

  await captureReplay(h, "running-on", () => advanceCycles(h, CYCLES));

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is still live");
  assertEqual(
    after.sim?.status,
    "running",
    "a machine holding no set never completes",
  );
  assertEqual(
    after.sim?.cycle,
    CYCLES,
    "every one of the twelve boundaries passed without completing, so the counter ran on",
  );
  assertNull(
    after.sim?.metrics ?? null,
    "nothing was recorded, because the run never completed",
  );
});
