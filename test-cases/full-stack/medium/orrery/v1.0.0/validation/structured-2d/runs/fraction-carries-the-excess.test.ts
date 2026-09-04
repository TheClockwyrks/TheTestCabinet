// runs/fraction-carries-the-excess — a cycle completes when the accumulated
// fraction reaches `1`, and what is left over starts the next cycle rather than
// being thrown away.
//
// THE RULE. "A cycle completes when the accumulated fraction reaches `1`, and the
// excess carries into the next cycle" (`specs/simulation.md`, Cycles and the
// clock). The clock the excess is measured on is the sentence above it: "an update
// advances the fraction by `SPEEDS[sim.speed] * dt` cycles, where `dt` is the
// frame's delta time in seconds and `SPEEDS` is `[1, 3, 10, 30]` cycles per
// second, indexed by the speed setting `0` to `3`".
//
// THE CONFIGURATION. Speed step `0`, where `SPEEDS[0]` is `1` cycle per second, so
// a span of game time in seconds IS a span in cycles and the arithmetic a reviewer
// checks is the specification's own. Two advances of `0.75` seconds: the first
// leaves `0.75` of cycle `0` accumulated, and the second carries the run `0.75`
// past the boundary — `1.5` cycles in all, which is cycle `1` half run.
//
// The world is a posed challenge with an EMPTY machine and an EMPTY field, so
// there is no part to fault, no mote to collide, and no sigil to act: what the two
// advances move is the clock and nothing else. The completion switch is held off,
// so no boundary can end the run.
//
// THE VERDICT. After the second advance `sim.cycle` is `1` and `sim.fraction` is
// `0.5`. A build that dropped the excess at the boundary reports `0`; one that
// never completed the cycle at all reports cycle `0`. The first advance is read
// back too, at `0.75` of cycle `0`, so the reading is of a clock that really moved
// rather than of one that stands still — and both fraction reads go through
// `assertNear` at `FRACTION_TOLERANCE`, because `specs/instrumentation.md` carries
// `sim.fraction` as a running sum of the frames' own delta times, which "agree to
// within the rounding of that sum rather than bit for bit".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { FRACTION_TOLERANCE, SPEEDS } from "../constants";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openBareRun,
  type Harness,
} from "../harness";

/** The step this check runs at: `SPEEDS[0]` is `1` cycle per second. */
const SLOWEST = 0;

/** Each advance, in seconds of game time. Two of them are one and a half cycles. */
const SPAN_SECONDS = 0.75;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries 0.5 of a cycle past the boundary rather than starting the next at 0", async () => {
  await openBareRun(h, { challenge: BARE, speed: SLOWEST });

  const opened = await h.snapshot();
  assertNotNull(
    opened.sim,
    "startRun leaves a live run, which the clock advances",
  );
  assertEqual(
    opened.sim?.speed,
    SLOWEST,
    `the run is set to step ${SLOWEST}, where SPEEDS[${SLOWEST}] is ${SPEEDS[SLOWEST]} cycle per second`,
  );

  await h.advanceSeconds(SPAN_SECONDS, 1);

  const part = await h.snapshot();
  assertEqual(
    part.sim?.cycle,
    0,
    `${SPAN_SECONDS} of a cycle does not reach the boundary, so no cycle has completed`,
  );
  assertNear(
    part.sim?.fraction ?? -1,
    SPAN_SECONDS,
    FRACTION_TOLERANCE,
    `the first advance accumulates ${SPAN_SECONDS} of cycle 0`,
  );

  await h.advanceSeconds(SPAN_SECONDS, 1);
  await captureStill(h, "carry");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.cycle,
    1,
    "the accumulated fraction reached 1 during the second advance, so cycle 0 completed",
  );
  assertNear(
    after.sim?.fraction ?? -1,
    2 * SPAN_SECONDS - 1,
    FRACTION_TOLERANCE,
    "the excess past the boundary carries into cycle 1 rather than being dropped",
  );
});
