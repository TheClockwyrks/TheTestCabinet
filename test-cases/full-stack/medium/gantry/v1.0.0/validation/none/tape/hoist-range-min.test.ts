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
//
// THE ARRIVAL IS SWEPT IN STRIDES RATHER THAN A TICK AT A TIME. What is read is
// where the axis stopped, not which tick it stopped on, so the run is advanced in
// blocks of `STRIDE` ticks until the axis is there or the run has ended — and the
// axis holds the target once it arrives (`specs/program.md`: an axis with no live
// command holds its value with zero rate), so a stride that lands past arrival
// reads exactly what a stride that lands on it would.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual, assertNull, fail } from "../assert";
import { HOIST_MAX_RATE, HOIST_MIN, TICK_HZ } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
} from "../harness";

/** A hair below the bound: outside the range, and nowhere near a rounding. */
const BELOW = 0.9;

/** Ticks driven in one block of the arrival sweep. */
const STRIDE = 12;

/**
 * Blocks allowed: `STRIDE * STRIDES` is `96` ticks, `1.6s` of run clock.
 *
 * From `HOIST_START` (`2`) to `HOIST_MIN` (`1`) is a unit, and `specs/program.md`
 * gives the hoist `HOIST_ACCEL` (`6`) — so the move is acceleration-bound at
 * `2 * sqrt(1 / 6)`, about `0.82s`, and this is twice that.
 */
const STRIDES = 8;

/** The controller sets the value to the target exactly on arrival. */
const TOL = 1e-9;

/** The axis is where the step sent it, or the run ended trying. */
function settled(s: GantrySnapshot): boolean {
  return (
    s.run.phase !== "running" ||
    Math.abs(s.run.axes.hoist.value - HOIST_MIN) <= TOL
  );
}

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
  let arrived = await runTicks(h, STRIDE);
  for (let block = 1; block < STRIDES && !settled(arrived); block += 1) {
    arrived = await runTicks(h, STRIDE);
  }
  if (!settled(arrived)) {
    fail(
      `the hoist to reach ${HOIST_MIN}, or the run to end trying, within ` +
        `${STRIDE * STRIDES} ticks (${((STRIDE * STRIDES) / TICK_HZ).toFixed(2)}s ` +
        "of run clock)",
      `it stands at ${arrived.run.axes.hoist.value} with the run ` +
        `"${arrived.run.phase}"`,
    );
  }
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
