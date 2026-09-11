// run/readouts — an axis with no live command shows no target.
//
// `specs/ui.md` § Run: the run screen shows "Each axis's value and its command's
// target while one is live". "While one is live" is a restriction, and this
// check decides it in the negative direction: the three axes a step does not
// command carry a value and nothing else. The affirmative direction — the
// commanded axis showing its target — is its own check.
//
// THE THREE UNCOMMANDED AXES ARE PUT AT FIGURES OF THEIR OWN FIRST. The tape's
// first step drives the trolley, the hoist and the grip to `1`, `3` and `4`,
// and its second step commands the slew alone. Left at the run-start posture
// those three would read `0`, `2` and `0` (`specs/program.md`), and a screen
// drawing a spurious target of `0` beside a value of `0` would be
// indistinguishable from one drawing no target at all. Driven somewhere first,
// every figure on those three lines has to be the axis's own value.
//
// EACH OF THE THREE IS AT LEAST TWICE `FIGURE_TOL` FROM THE FIGURE IT WOULD
// HAVE READ AT THE RUN-START POSTURE, which is the whole of what the settling
// step has to buy: that margin is what makes a spurious `0` a stray figure
// rather than a rounding of the value. Travelling further than that buys the
// reading nothing, and every extra tick of it is more of the axis controller
// standing between this point and its verdict.
//
// THEY ARE DRIVEN RATHER THAN POSED because posing the trolley or the hoist
// mid-run moves the pivot or the cable a whole unit between two ticks, and the
// pendulum that follows (`specs/rigging.md`) snaps the cable and ends the run.
//
// EACH READOUT IS THE ONE ITS AXIS'S NAME ANCHORS, and the reading is of the
// WHOLE readout: a target drawn with the value would put a second figure there,
// and that is exactly what this refuses. `./axis-readout` gathers a readout as
// the figures nearest the axis's own name, so a build drawing the four axes as
// four rows and one drawing them along a single line are read the same way —
// each axis answering for its own figures and for no other axis's.

import { afterEach, beforeEach, it } from "vitest";

import { axisReadouts, everythingDrawn } from "./axis-readout";
import { assertTrue, fail } from "../assert";
import {
  GRIP_MAX_RATE,
  HOIST_MAX_RATE,
  SLEW_MAX_RATE,
  TROLLEY_MAX_RATE,
} from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type AxisName,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The three axes the tape's second step leaves alone. */
const QUIET: readonly AxisName[] = ["trolley", "hoist", "grip"];

/** The settling step, then a step that commands the slew and nothing else. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "trolley", target: 1, rate: TROLLEY_MAX_RATE },
      { axis: "hoist", target: 3, rate: HOIST_MAX_RATE },
      { axis: "grip", target: 4, rate: GRIP_MAX_RATE },
    ],
  },
  {
    kind: "move",
    commands: [{ axis: "slew", target: 253, rate: SLEW_MAX_RATE }],
  },
];

/** Ticks the settling step is given before the check calls it a fault. */
const SETTLE_CAP = 120;

/**
 * Ticks carried in one crossing before the sweep starts looking.
 *
 * The settling step takes about sixty ticks, and `runUntil` costs a crossing
 * into the page for every tick it polls. Nothing is read until the slew's
 * command is live, so the ticks before that can be driven blind; the sweep
 * still finds the tick it goes live on, and still fails on the cap.
 */
const CARRY = 40;

/** How far a drawn figure may sit from the value it reads: whole units. */
const FIGURE_TOL = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws no target beside an axis carrying no live command", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);
  await runTicks(h, CARRY);
  const state = await runUntil(
    h,
    (snapshot) => snapshot.run.axes.slew.command !== null,
    SETTLE_CAP,
    "the tape's second step to put a live command on the slew",
  );

  assertTrue(
    state.screen === "run" && state.run.phase === "running",
    "the run screen showing a run in progress, so its readouts are the ones " +
      `specs/ui.md lists (screen "${state.screen}", run "${state.run.phase}")`,
  );
  for (const axis of QUIET) {
    assertTrue(
      state.run.axes[axis].command === null,
      `the ${axis} axis carrying no live command while the slew's step runs ` +
        "(specs/program.md)",
    );
  }

  const calls = await h.screenCalls();
  const readouts = axisReadouts(calls);
  await h.capture("axis-readout", "The axis readouts with one command live");

  for (const axis of QUIET) {
    const value = state.run.axes[axis].value;
    const readout = readouts[axis];
    if (!readout.named) {
      fail(
        `the run screen to name the ${axis} axis, so what is drawn beside it ` +
          "reads as that axis's (specs/ui.md)",
        "no run of drawn text names it, in full or by its initial: " +
          `[${everythingDrawn(calls)}]`,
      );
    }
    // Every figure the readout shows under EITHER reading (`./figures`) is a
    // figure this axis's readout draws, so a build that groups its figures
    // with a space is held to the same rule as one that groups with a comma:
    // a target no command set is a stray however the build sets it.
    const stray = readout.figures.filter(
      (figure) => Math.abs(figure - value) > FIGURE_TOL,
    );
    if (stray.length > 0) {
      fail(
        `the ${axis} axis's readout to carry its value, ` +
          `${value.toFixed(2)}, and no target: no command is live on it ` +
          "(specs/ui.md)",
        `that readout reads [${readout.reads}], carrying ` +
          `[${stray.join(", ")}] besides`,
      );
    }
  }
});
