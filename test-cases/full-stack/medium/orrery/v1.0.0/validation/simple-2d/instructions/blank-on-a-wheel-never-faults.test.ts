// instructions/blank-on-a-wheel-never-faults — a blank cell on a wheel is a rest,
// not an `impossible`.
//
// THE RULE, stated twice. "A blank cell is a rest: the part holds its pose for
// the cycle" (`specs/instructions.md`), and the cycle's fetch step spells out
// which parts that covers: "A blank cell is a rest on every part, a wheel
// included, and never faults" (`specs/simulation.md`, Cycles and the clock). So
// the wheel rule — "a wheel given anything but `rotate-cw` or `rotate-ccw` faults
// as `impossible` whatever else would apply" — is about a NON-BLANK cell, exactly
// as `FAULTS` writes it: "`impossible` — ... any non-blank instruction but
// `rotate-cw` or `rotate-ccw` on a wheel."
//
// THE CONFIGURATION. One wheel at the origin, on an otherwise empty machine,
// whose tape holds a blank at column `0` and `rotate-cw` at column `1` — so the
// tape's length is `2`, the machine's period is `2`, and cycle `0` fetches a
// WRITTEN blank rather than a cell past the tape's end. Only cycle `0` is run.
// `openBareRun` empties the field, which takes the wheel's six fixtures with it,
// so no mote is on the field and nothing else can fault in the wheel's place.
//
// THE VERDICT. The cycle reaches its boundary: `sim.status` is `running`,
// `sim.fault` is `null`, and `sim.cycle` is `1`. And the wheel RESTED rather than
// being skipped: its live rotation is the rotation it began the cycle with, which
// is what makes the verdict a reading about a cycle that ran rather than about a
// run that never moved.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull, assertNull } from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  partIds,
  poseOf,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs a wheel's blank cell to the boundary, raising no impossible", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("wheel", ORIGIN.q, ORIGIN.r, 0, 1, [null, "rotate-cw"]),
    ]),
  });
  const wheel = (await partIds(h))[0] ?? -1;

  const before = await h.snapshot();
  const was = poseOf(before, wheel);
  assertNotNull(
    was,
    "the run carries a live pose for the wheel before the cycle",
  );

  await captureReplay(h, "wheel-rest", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is live through the cycle");
  assertEqual(
    after.sim?.status,
    "running",
    "a blank cell is a rest on every part, a wheel included, so the cycle does not fault",
  );
  assertNull(
    after.sim?.fault ?? null,
    "a blank cell never faults, so no impossible is raised on the wheel",
  );
  assertEqual(
    after.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );
  assertNear(
    after.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "a completed cycle leaves the fraction on the boundary it reached",
  );
  const now = poseOf(after, wheel);
  assertNotNull(now, "the run still carries a live pose for the wheel");
  assertEqual(
    now?.rotation,
    was?.rotation,
    "the wheel rested through its blank cell rather than turning",
  );
});
