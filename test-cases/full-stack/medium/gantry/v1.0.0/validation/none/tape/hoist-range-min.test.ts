// tape/hoist-range-min — the hoist's range starts at HOIST_MIN, so a step
// targeting it arrives and one a hair under it ends the run.
//
// `specs/program.md` § The axes gives the `hoist` row the range "`HOIST_MIN` (`1`)
// to `HOIST_MAX` (`40`)", and § The tape gives what a target outside it costs:
// "Targets are accepted as written: whether a target is reachable depends on the
// structure, so it is judged when the step starts. A step whose command targets a
// value outside its axis's range at that moment ends the run as
// `command-out-of-range`."
//
// BOTH SIDES OF THE ONE BOUND, IN ONE CHECK, because they are one edge case read
// twice: `1` is inside the range and `0.9` is outside it, and a build that put the
// bound in the wrong place, or made it exclusive, answers differently on exactly
// one of the two. The gap of a tenth of a unit is well clear of any arithmetic a
// conforming build does — the target is compared, not computed.
//
// THE FIRST RUN IS DRIVEN TO ARRIVAL rather than stopped at the issue, because the
// claim on this side of the bound is that the axis reaches `HOIST_MIN`: the cable
// shortens from `HOIST_START` (`2`), which lifts the bare hook, so nothing else can
// end the run on the way. THE SECOND IS READ ON ITS FIRST TICK, which is the tick
// that takes the step and judges it.
//
// The two runs are posed on the same crane one after the other; the tape is
// emptied between them so each run carries the one step it is about. The yard is
// empty: nothing here concerns a load.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual, assertNull } from "../assert";
import { HOIST_MAX_RATE, HOIST_MIN, TICK_HZ } from "../constants";
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

/** A hair below the bound: outside the range, and nowhere near a rounding. */
const BELOW = 0.9;

/** From HOIST_START (2) to HOIST_MIN (1) is a unit at up to 4 u/s. */
const CAP = 5 * TICK_HZ;

/** The controller sets the value to the target exactly on arrival. */
const TOL = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reaches a hoist target of HOIST_MIN and refuses one below it", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);

  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "hoist", target: HOIST_MIN, rate: HOIST_MAX_RATE }],
    },
  ]);
  await startRun(h);
  const arrived = await runUntil(
    h,
    (s) =>
      s.run.phase !== "running" ||
      Math.abs(s.run.axes.hoist.value - HOIST_MIN) <= TOL,
    CAP,
    `the hoist to reach ${HOIST_MIN}, or the run to end trying`,
  );
  assertNull(
    arrived.run.cause,
    `the failure cause of a run whose hoist was told to reach ${HOIST_MIN}, ` +
      "which is inside the hoist's range (specs/program.md)",
  );
  assertClose(
    arrived.run.axes.hoist.value,
    HOIST_MIN,
    TOL,
    "the hoist's value where its command stopped (specs/program.md)",
  );
  await h.debug.abortRun();

  await h.debug.setScreen("program");
  await h.debug.clearProgram();
  await h.debug.setScreen("build");
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "hoist", target: BELOW, rate: HOIST_MAX_RATE }],
    },
  ]);
  await startRun(h);
  const refused = await runTicks(h, 1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    refused.run.phase,
    "failed",
    `the phase of a run whose first step targets the hoist at ${BELOW}, ` +
      `below HOIST_MIN (${HOIST_MIN}) (specs/program.md)`,
  );
  assertEqual(
    refused.run.cause,
    "command-out-of-range",
    "the cause a target outside the axis's range ends the run with " +
      "(specs/program.md)",
  );
});
