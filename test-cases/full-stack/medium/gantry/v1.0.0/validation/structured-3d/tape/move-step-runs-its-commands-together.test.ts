// tape/move-step-runs-its-commands-together — the commands of one move step are
// issued together and drive their axes from the same tick.
//
// `specs/program.md` § The tape: "A move: one or more commands, at most one per
// axis... The step's commands run together". § The tick pipeline says when: "a
// move step issues its commands to their axes", which is one stage of one tick, so
// the tick that takes the step is the tick every one of its commands starts on.
//
// TWO AXES THAT SHARE NOTHING. The step carries a `slew` command and a `hoist`
// command: one turns the arm and one pays out the cable, they have different
// accelerations and different max rates, and neither's motion is a consequence of
// the other's. So a build that issued the step's commands one at a time — the
// first on the tick that took the step and the next when the first was done, which
// is how a step reads if it is mistaken for a queue — leaves the second axis
// stopped with no command on the reading below.
//
// THE READING IS THE FIRST TICK, and it is two things about each axis: a live
// command, which says the command was issued, and a rate that has left zero, which
// says the axis moved under it. `specs/program.md` § Axis motion has a driving
// tick change the rate by `a * dt`, so an axis commanded on this tick is turning by
// the end of it and one not commanded is still stopped — `specs/state.md`: "An
// axis with no live command reports `0` and holds its value with zero rate."
//
// The targets are far enough that neither command can be done on the tick it was
// issued: `specs/program.md` makes a command whose target is the axis's current
// value complete immediately, which would leave nothing to read.
//
// The crane is the harness's minimal one and the yard is empty: nothing here
// concerns a load, and the reading is about the tape rather than the structure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertNotNull } from "../assert";
import { HOIST_MAX_RATE, HOIST_START, SLEW_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The two targets, each many ticks away from where its axis starts. */
const SLEW_TARGET = 90;
const HOIST_TARGET = HOIST_START + 4;

/** One step, two commands: a move is "one or more commands, at most one per axis". */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "slew", target: SLEW_TARGET, rate: SLEW_MAX_RATE },
      { axis: "hoist", target: HOIST_TARGET, rate: HOIST_MAX_RATE },
    ],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("issues both of a move step's commands on the tick that takes it", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  const first = await runTicks(h, 1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    first.run.tick,
    1,
    "the tick the reading is taken on: the first, which is the tick that " +
      "takes the first step (specs/program.md)",
  );
  for (const [axis, target] of [
    ["slew", SLEW_TARGET],
    ["hoist", HOIST_TARGET],
  ] as const) {
    assertNotNull(
      first.run.axes[axis].command,
      `the command live on the ${axis} after the tick that took the step ` +
        "carrying both (specs/program.md)",
    );
    assertEqual(
      first.run.axes[axis].command?.target,
      target,
      `the target the ${axis}'s live command carries (specs/program.md)`,
    );
    assertNotEqual(
      first.run.axes[axis].rate,
      0,
      `the ${axis}'s rate after that tick: a commanded axis drives on the ` +
        "tick its command is issued (specs/program.md)",
    );
  }
});
