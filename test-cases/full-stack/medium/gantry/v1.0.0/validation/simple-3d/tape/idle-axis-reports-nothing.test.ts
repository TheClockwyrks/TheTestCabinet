// tape/idle-axis-reports-nothing — an axis with no live command holds its value
// with zero rate.
//
// specs/program.md § Axis motion closes with it: "An axis with no live command
// reports `0` and holds its value with zero rate." So a tape that commands one
// axis leaves the other three exactly where the run started them, tick after
// tick, with no rate and no command of their own.
//
// THE OTHER THREE AXES ARE READ ON EVERY TICK OF A MOVING RUN, because the
// requirement is that nothing bleeds across: the run is ticking, the arm is
// turning, the pivot is moving and the pendulum is swinging, and through all of
// it the trolley, the hoist and the grip are still. A build that let a moving
// slew drag the trolley along the track, or that let the swinging bob pay out
// cable, parts from this on the tick it happens rather than at the end.
//
// The commanded axis is the slew, at its max rate to a target far enough that it
// is still turning when the sampling ends: the arm sweeps through a quarter turn,
// which is the motion most likely to disturb the other three. The run-start
// values the others are held to are the ones specs/program.md fixes — `trolley`
// `0`, `hoist` `HOIST_START`, `grip` `0` — rather than a reading taken from the
// build.
//
// The yard is emptied so no load is on the hook: a lift is not what this is
// about, and the hoist would then be holding one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { HOIST_START, SLEW_MAX_RATE, TICK_HZ } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** A quarter turn: far more than the sampled ticks cover. */
const TARGET = 90;

/** A second of run clock, every tick of it read. */
const TICKS = TICK_HZ;

/** What the run starts the three uncommanded axes at (specs/program.md). */
const IDLE = [
  { axis: "trolley", value: 0 },
  { axis: "hoist", value: HOIST_START },
  { axis: "grip", value: 0 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds every uncommanded axis at its run-start value with no rate", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "slew", target: TARGET, rate: SLEW_MAX_RATE }],
    },
  ]);
  await startRun(h);

  for (let tick = 1; tick <= TICKS; tick += 1) {
    const state = await runTicks(h, 1);
    for (const { axis, value } of IDLE) {
      const seen = state.run.axes[axis];
      assertEqual(
        seen.value,
        value,
        `the ${axis}'s value on tick ${tick}, with no command of its own on a ` +
          "run whose slew is turning (specs/program.md)",
      );
      assertEqual(
        seen.rate,
        0,
        `the ${axis}'s rate on tick ${tick}: an axis with no live command ` +
          "holds its value with zero rate (specs/program.md)",
      );
      assertNull(
        seen.command,
        `the ${axis}'s command on tick ${tick}, which the tape never gives it ` +
          "(specs/program.md)",
      );
    }
  }

  await h.capture("state", "The three idle axes after a second of slewing");
});
