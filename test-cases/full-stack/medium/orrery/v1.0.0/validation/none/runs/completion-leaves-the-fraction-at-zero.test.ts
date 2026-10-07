// runs/completion-leaves-the-fraction-at-zero — a boundary that completes the run
// leaves `sim.fraction` at `0` rather than at whatever the frame that crossed it
// carried past.
//
// THE RULE. "A `collision` leaves the fraction at that sample's `k / 8`; every
// other fault and completion leaves it at `0`" (`specs/simulation.md`, Cycles and
// the clock). What completes a run is the boundary's last step: "After the rises,
// if every set's tally has reached the challenge's `target`, the run completes: the
// status becomes `complete` and the metrics are recorded" (Completion and metrics).
//
// THE CONFIGURATION. `ONE_DELIVERY`, whose `target` is `1`, with a machine holding
// its one set and nothing else — a set is required, because "A run whose machine
// holds no set never completes". The run is opened with the completion switch left
// ON, which is what `openRun` is for: completion is "the game's one autonomous
// consequence", and this point is about it.
//
// The tally is posed with `setTally`, which "Sets the tally of the open
// challenge's product `index` to `n`" — a pose that "sets one thing" and decides
// nothing, since "every ... delivery, and completion comes from the frames
// advanced after the pose" (`specs/instrumentation.md`). So the run is carrying a
// satisfied target while it is still inside cycle `0`, and the boundary that ends
// that cycle is the one that reads it.
//
// THE FRACTION THE RUN IS CARRYING WHEN IT COMPLETES IS `0.5`, ON PURPOSE. The run
// is driven half a cycle, and that half is read back before the completing
// boundary. Then a further whole cycle is handed to it, so the span crosses the
// boundary with half a cycle of game time to spare: a build that carried the
// excess through the completion, as `specs/simulation.md` has it carry excess
// across an ordinary boundary, would report `0.5`, and a build that never advanced
// the fraction at all fails the earlier reading.
//
// THE VERDICT. `sim.status` is `complete` and `sim.fraction` reads `0`, through
// `assertNear` at `FRACTION_TOLERANCE` because the fraction is a running sum whose
// figures "agree to within the rounding of that sum rather than bit for bit"
// (`specs/instrumentation.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { setPart, solution } from "../formats";
import { EAST, ONE_DELIVERY } from "../fixtures";
import {
  advanceCycles,
  advanceFraction,
  captureStill,
  createHarness,
  openRun,
  tallyOf,
  type Harness,
} from "../harness";

/** How far into cycle `0` the run stands when the target is posed as reached. */
const PART_WAY = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports sim.fraction 0 at the boundary that completed the run", async () => {
  await openRun(h, {
    challenge: ONE_DELIVERY,
    machine: solution([setPart(0, EAST.q, EAST.r)]),
  });

  const opened = await h.snapshot();
  assertNotNull(
    opened.sim,
    "startRun leaves a live run on the posed challenge",
  );
  assertEqual(
    opened.completion,
    true,
    "openRun leaves the completion switch on, so a satisfied target ends the run",
  );
  const target = opened.challenge?.target ?? 0;
  assertEqual(
    target,
    1,
    "ONE_DELIVERY's target is 1, so one delivery satisfies it",
  );

  await advanceFraction(h, PART_WAY);
  await h.debug.setTally(0, target);

  const carrying = await h.snapshot();
  assertEqual(
    carrying.sim?.status,
    "running",
    "the tally is posed part way through cycle 0, before any boundary has read it",
  );
  assertEqual(
    tallyOf(carrying, 0),
    target,
    "setTally leaves the one product's tally at the challenge's target",
  );
  assertNear(
    carrying.sim?.fraction ?? -1,
    PART_WAY,
    FRACTION_TOLERANCE,
    "the fraction advanced with game time before the completing boundary",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "complete");

  const done = await h.snapshot();
  assertEqual(
    done.sim?.status,
    "complete",
    "the boundary of cycle 0 found every set's tally at the target, so the run completed",
  );
  assertNear(
    done.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "a completing boundary leaves the fraction at 0, carrying no excess past it",
  );
});
