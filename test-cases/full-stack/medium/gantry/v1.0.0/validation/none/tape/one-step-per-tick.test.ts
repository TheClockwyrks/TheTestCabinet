// tape/one-step-per-tick — a tick takes at most one step from the tape.
//
// `specs/program.md` § The tick pipeline: "A tick takes at most one step from the
// tape." Stage 1 of a tick completes the live step, and only "If no step is
// live, this tick takes the next one" — one, never the one after it, however
// quickly the one it took finishes.
//
// THE TAPE IS FOUR STEPS THAT EACH FINISH ON THE TICK THAT ISSUES THEM, which is
// the case the requirement is about: a step that lingers cannot be consumed with
// its neighbours whether or not the rule holds. Every step commands its axis to
// the value that axis already stands at, and `specs/program.md` § Axis motion
// fixes what that does: "A command whose target is the axis's current value
// therefore has `s` of `0`: the axis neither brakes nor accelerates, it does not
// move, and step 3 finds it arrived, so the command is done on the tick it is
// issued." The four targets are the run-start posture that same file gives —
// `slew` `0`, `trolley` `0`, `hoist` `HOIST_START`, `grip` `0` — so each step is
// complete the moment it is taken and a tape-consuming build would run out of
// tape on tick one.
//
// SO THE COUNT IS THE READING. A tick takes one step, and the step it took is
// found complete at the top of the next, which takes the next one: `stepIndex`
// therefore stands at `k - 1` at the end of tick `k`, and the fifth tick is the
// first that finds no step left. Four steps, four ticks.
//
// The yard is emptied and the crane is the minimal one, because the requirement
// is about the tape alone: no load, no obstacle, and nothing about this structure
// beyond its standing up is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  GRIP_MAX_RATE,
  HOIST_MAX_RATE,
  HOIST_START,
  SLEW_MAX_RATE,
  TROLLEY_MAX_RATE,
} from "../constants";
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

/**
 * Four move steps, each commanding one axis to the value it already holds at the
 * run-start posture, so each is done on the tick that issues it.
 */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: 0, rate: SLEW_MAX_RATE }],
  },
  {
    kind: "move",
    commands: [{ axis: "trolley", target: 0, rate: TROLLEY_MAX_RATE }],
  },
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE }],
  },
  {
    kind: "move",
    commands: [{ axis: "grip", target: 0, rate: GRIP_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances one step of the tape per tick, however fast each finishes", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  for (let tick = 1; tick <= TAPE.length; tick += 1) {
    const s = await runTicks(h, 1);
    assertEqual(s.run.tick, tick, "the tick the run is on");
    assertEqual(
      s.run.stepIndex,
      tick - 1,
      `run.stepIndex at the end of tick ${tick}: a tick takes at most one ` +
        "step from the tape, so the four steps are taken on four ticks " +
        "(specs/program.md)",
    );
    assertTrue(
      s.run.phase === "running",
      `the run still under way at the end of tick ${tick}, with ` +
        `${TAPE.length - tick} of its ${TAPE.length} steps still to take`,
    );
  }

  // The fifth tick is the first that finds no live step and no step left.
  const ended = await runTicks(h, 1);
  await h.capture("state", "The tape one step per tick, four steps in");

  assertEqual(
    ended.run.tick,
    TAPE.length + 1,
    `the tick a tape of ${TAPE.length} steps that each finish where they are ` +
      "issued runs out on (specs/program.md)",
  );
  assertEqual(
    ended.run.stepIndex,
    TAPE.length,
    "run.stepIndex once every step is complete",
  );
});
