// tape/slew-is-unbounded — the slew angle is a plain number, so a tape may wind
// the arm past a full turn.
//
// `specs/program.md` § The axes gives the `slew` row a range of "unbounded" and
// says so again in words: "The slew angle is a plain number rather than a wrapped
// one, so `360` is a full turn past `0` and a tape may wind the arm around as
// often as it likes." The tape rule it is measured against is in the same file: a
// step "whose command targets a value outside its axis's range at that moment ends
// the run as `command-out-of-range`", and an unbounded axis has no such value.
//
// TWO FULL TURNS, because the reading has to separate a plain number from the
// three ways a build might spoil it. A build that wrapped the angle into
// `[0, 360)` reports `0` where the specification asks for `720`; one that clamped
// at a turn reports `360`; one that judged the target out of range fails the run.
//
// THE YARD IS EMPTY AND THE CRANE IS THE MINIMAL ONE, so nothing but the arm's own
// weight turns: no load to swing into the ground, no obstacle to sweep into, and
// the whole verdict rests on where the axis stops.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual, assertNull } from "../assert";
import { SLEW_MAX_RATE, TICK_HZ } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Two full turns: past a wrap, past a clamp at one turn. */
const TARGET = 720;

const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: TARGET, rate: SLEW_MAX_RATE }],
  },
];

/**
 * The cap: `720` degrees at `SLEW_MAX_RATE` is twenty-four seconds of run clock
 * before the ramps at either end, so thirty-five seconds is comfortable slack and
 * still bounds a build that never arrives.
 */
const CAP = 35 * TICK_HZ;

/** The controller sets the value to the target exactly on arrival. */
const TOL = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("winds the slew to a target two full turns past its start", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  const arrived = await runUntil(
    h,
    (s) =>
      s.run.phase !== "running" ||
      Math.abs(s.run.axes.slew.value - TARGET) <= TOL,
    CAP,
    `the slew to reach ${TARGET}, or the run to end trying`,
  );
  await h.capture("state", "The driven state this point decides");

  assertNull(
    arrived.run.cause,
    `the failure cause of a run whose slew was told to turn to ${TARGET}: ` +
      "the slew's range is unbounded (specs/program.md)",
  );
  assertClose(
    arrived.run.axes.slew.value,
    TARGET,
    TOL,
    "the slew's value where its command stopped (specs/program.md)",
  );
  assertEqual(
    arrived.run.axes.slew.rate,
    0,
    "the slew's rate once it arrived (specs/program.md)",
  );
});
