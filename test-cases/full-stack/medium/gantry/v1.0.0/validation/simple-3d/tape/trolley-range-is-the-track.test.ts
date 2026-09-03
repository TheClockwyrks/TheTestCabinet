// tape/trolley-range-is-the-track — the trolley's range runs from 0 to the
// track's length, so a step targeting the length arrives and one past it ends the
// run.
//
// `specs/program.md` § The axes gives the `trolley` row the range "`0` to the
// track length", and says it again of the run: "The trolley's range is the one
// that moves during a run: its upper bound is the track's current length
// (`specs/structure.md`)". `specs/structure.md` states the same value from the
// geometry's side: "The trolley's position is its distance along the track from
// that origin, from `0` to the track's length". What a target past it costs is §
// The tape's rule: "A step whose command targets a value outside its axis's range
// at that moment ends the run as `command-out-of-range`."
//
// BOTH SIDES OF THE ONE BOUND, IN ONE CHECK, because they are one edge case read
// twice: the track's length is inside the range and half a unit past it is
// outside, and a build that took the bound from somewhere other than the track —
// a fixed figure, the rail count, the far node's distance from the slew axis —
// answers differently on one of the two.
//
// THE TRACK IS THE MINIMAL CRANE'S, one rail from `(0, 4, 0)` to `(4, 4, 0)`, so
// its length is `4` by the arithmetic of the nodes rather than by anything the
// build reports. The first run is driven to arrival, which is what makes the
// bound reachable rather than merely accepted; the second is read on its first
// tick, the tick that takes the step and judges it.
//
// The yard is empty and the hook hangs at `HOIST_START` over a horizontal track,
// so nothing else can end either run while the scenario is waiting.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual, assertNull } from "../assert";
import { TICK_HZ, TROLLEY_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** The minimal crane's track: one rail from (0, 4, 0) to (4, 4, 0). */
const TRACK_LENGTH = 4;

/** Half a unit past the far end: outside the range. */
const BEYOND = TRACK_LENGTH + 0.5;

/** Four units at up to 4 u/s with a ramp at each end: two seconds. */
const CAP = 6 * TICK_HZ;

/** The controller sets the value to the target exactly on arrival. */
const TOL = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reaches a trolley target at the track's length and refuses one past it", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);

  await poseTape(h, [
    {
      kind: "move",
      commands: [
        { axis: "trolley", target: TRACK_LENGTH, rate: TROLLEY_MAX_RATE },
      ],
    },
  ]);
  await startRun(h);
  const arrived = await runUntil(
    h,
    (s) =>
      s.run.phase !== "running" ||
      Math.abs(s.run.axes.trolley.value - TRACK_LENGTH) <= TOL,
    CAP,
    `the trolley to reach ${TRACK_LENGTH}, or the run to end trying`,
  );
  assertNull(
    arrived.run.cause,
    `the failure cause of a run whose trolley was told to reach ` +
      `${TRACK_LENGTH}, the track's own length (specs/program.md)`,
  );
  assertClose(
    arrived.run.axes.trolley.value,
    TRACK_LENGTH,
    TOL,
    "the trolley's value where its command stopped (specs/program.md)",
  );
  await h.debug.abortRun();

  await h.debug.setScreen("program");
  await h.debug.clearProgram();
  await h.debug.setScreen("build");
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "trolley", target: BEYOND, rate: TROLLEY_MAX_RATE }],
    },
  ]);
  await startRun(h);
  const refused = await runTicks(h, 1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    refused.run.phase,
    "failed",
    `the phase of a run whose first step targets the trolley at ${BEYOND}, ` +
      `past the track's length of ${TRACK_LENGTH} (specs/program.md)`,
  );
  assertEqual(
    refused.run.cause,
    "command-out-of-range",
    "the cause a target outside the axis's range ends the run with " +
      "(specs/program.md)",
  );
});
