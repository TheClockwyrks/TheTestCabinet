// runs/no-completion-below-the-target — one short is short.
//
// THE RULE. "After the rises, IF every set's tally has reached the challenge's
// `target`, the run completes" (`specs/simulation.md`, Completion and metrics).
// A tally below the target reaches nothing, and the boundary ends the way every
// other boundary ends: "When the run does not complete, `sim.cycle` increments
// and the next cycle begins" (`specs/simulation.md`, the boundary step of a
// cycle).
//
// THE CONFIGURATION is the narrowest margin there is: one `set` alone on the
// field with its tally posed at `CONSTELLATION_TARGET - 1`, and nothing on its
// footprint to deliver, so the boundary the check runs to is one where the tally
// is exactly one short and stays there. The completion switch is left ON, so a
// build that completes here completes for the reason this point is about.
//
// THE VERDICT is all three things the rule promises of a boundary that does not
// complete: the status is still `running`, `sim.cycle` has incremented, and the
// next cycle really is under way — read as a fraction part way through cycle `1`
// after a further third of a cycle of game time, which a completed or frozen run
// could not show.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull, assertNull } from "../assert";
import { CONSTELLATION_TARGET, FRACTION_TOLERANCE } from "../constants";
import { setPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  advanceFraction,
  captureReplay,
  createHarness,
  openRun,
  tallyOf,
  type Harness,
} from "../harness";

/** The whole machine: one set for the challenge's only product, at the origin. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

/** How far into cycle 1 the check looks to see that the next cycle began. */
const INTO_THE_NEXT_CYCLE = 1 / 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries on past a boundary where the only set's tally is one short", async () => {
  await openRun(h, { challenge: BARE, machine: ONE_SET });
  await h.debug.setTally(0, CONSTELLATION_TARGET - 1);

  const before = await h.snapshot();
  assertEqual(
    before.challenge?.target,
    CONSTELLATION_TARGET,
    "the posed challenge asks for CONSTELLATION_TARGET",
  );
  assertEqual(
    tallyOf(before, 0),
    CONSTELLATION_TARGET - 1,
    "the one set's tally stands one short of the target",
  );
  assertEqual(before.sim?.cycle, 0, "the run is at the start of cycle 0");

  await captureReplay(h, "carrying-on", async () => {
    await advanceCycles(h, 1);
    await advanceFraction(h, INTO_THE_NEXT_CYCLE);
  });

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is still live");
  assertEqual(
    tallyOf(after, 0),
    CONSTELLATION_TARGET - 1,
    "nothing was delivered, so the tally is still one short",
  );
  assertEqual(
    after.sim?.status,
    "running",
    "a tally short of the target does not complete the run",
  );
  assertNull(
    after.sim?.metrics ?? null,
    "no metrics are recorded, because the run did not complete",
  );
  assertEqual(
    after.sim?.cycle,
    1,
    "the boundary did not complete, so sim.cycle incremented",
  );
  assertNear(
    after.sim?.fraction ?? -1,
    INTO_THE_NEXT_CYCLE,
    FRACTION_TOLERANCE,
    "the next cycle began, and the clock is running through it",
  );
});
