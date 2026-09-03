// tape/trolley-range-below-zero — the trolley axis's range starts at the track
// origin, so `0` is reachable and anything below it ends the run.
//
// `specs/program.md` § The axes gives the `trolley` row's range as "`0` to the
// track length", and § The tape fixes what a target outside a range costs: "A
// step whose command targets a value outside its axis's range at that moment
// ends the run as `command-out-of-range`." The bound this point decides is the
// lower one, and a bound is only decided by reading both sides of it: a build
// that refuses `0` and a build that accepts `-0.5` misplace the same edge, and
// one run cannot tell them apart. So the same crane runs two tapes.
//
// THE FIRST TAPE COMMANDS THE TROLLEY TO `0`, which is where every run starts it
// ("`trolley` `0`, the track origin"), so the command's distance to go is `0`:
// "A command whose target is the axis's current value therefore has `s` of `0` …
// so the command is done on the tick it is issued." The tape then runs out and
// the run ends with no cause — `0` was inside the range.
//
// THE SECOND COMMANDS `-0.5`, half a unit below that origin and outside the
// range at the moment its step starts. The reading is taken one tick after the
// start, which is the tick that takes the step, so a build that lets the step
// start reads `running` here and fails.
//
// The world holds nothing else — no loads, no obstacles, and the smallest crane
// that stands — because the requirement is about an axis's range rather than
// about anything the crane carries.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual, assertNull } from "../assert";
import { TROLLEY_MAX_RATE } from "../constants";
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
  type TapeStepSpec,
} from "../harness";

/** The track origin itself: inside the range, and where the trolley stands. */
const AT_THE_ORIGIN: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "trolley", target: 0, rate: TROLLEY_MAX_RATE }],
  },
];

/** Half a unit below the origin: outside the range at either end. */
const BELOW_THE_ORIGIN: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "trolley", target: -0.5, rate: TROLLEY_MAX_RATE }],
  },
];

/** Ticks the first run is given to run out of tape: it takes two. */
const CAP = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes a trolley target of 0 and ends the run below it", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);

  // The tape is edited, and a run is started, from the program screen: a run
  // that clears leaves the results screen showing, and the second tape is posed
  // and started from where the tape lives rather than by walking a menu.
  await h.debug.setScreen("program");
  await poseTape(h, AT_THE_ORIGIN);
  await startRun(h);
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    CAP,
    "the run commanding the trolley to the track origin to run out of tape",
  );

  assertNull(
    ended.run.cause,
    "the cause of a run whose only command targets 0, the trolley range's " +
      "lower bound (specs/program.md)",
  );
  assertClose(
    ended.run.axes.trolley.value,
    0,
    1e-9,
    "run.axes.trolley.value at the end of that run: the target it arrived at",
  );

  await h.debug.setScreen("program");
  await h.debug.clearProgram();
  await poseTape(h, BELOW_THE_ORIGIN);
  await startRun(h);
  const below = await runTicks(h, 1);

  await h.capture("state", "The run a trolley target below the origin ended");

  assertEqual(
    below.run.phase,
    "failed",
    "the phase one tick after a run whose step targets the trolley at -0.5, " +
      "below the range's lower bound of 0 (specs/program.md)",
  );
  assertEqual(
    below.run.cause,
    "command-out-of-range",
    "the cause that step's target carries (specs/program.md)",
  );
});
