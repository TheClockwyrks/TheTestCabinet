// tape/step-index-reaches-the-tape-length — the step index climbs to the number
// of steps once the tape has run out.
//
// `specs/state.md` § The run counts the step index from `0`, and
// `specs/program.md` § The tick pipeline says where it stops: "A tick that finds
// no live step and no step left to take is the tick the run ends on". A tape of
// `n` steps therefore leaves the index at `n` — one past the last step, which is
// the reading that says every step was taken and completed rather than that the
// run stopped on the last one.
//
// THREE STEPS, so the reading is a count rather than a coincidence: an index that
// stopped at the last step's own number reads `2` here, and an index counted from
// `1` reads `4`. Each step commands a different axis, and each asks for the
// smallest genuine move of it — a target a few hundredths off where the axis
// stands, which `specs/program.md`'s controller accelerates into and arrives at
// within a handful of ticks. The tape therefore runs out well inside the sweep
// while every step is still a real move that has to be taken, driven and
// completed, and the index is read against the tape the snapshot itself reports
// rather than against the number this file wrote.
//
// The world holds nothing but the smallest crane that stands: a run that ended
// for any other reason than running out of tape is a different reading, and with
// no load and no obstacle there is nothing else for it to end on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  GRIP_MAX_RATE,
  HOIST_MAX_RATE,
  HOIST_START,
  SLEW_MAX_RATE,
} from "../constants";
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

/** Three moves, one axis each, every one of them as short as a move can be. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 0.02, rate: HOIST_MAX_RATE },
    ],
  },
  {
    kind: "move",
    commands: [{ axis: "grip", target: 0.05, rate: GRIP_MAX_RATE }],
  },
  {
    kind: "move",
    commands: [{ axis: "slew", target: 0.05, rate: SLEW_MAX_RATE }],
  },
];

/** Ticks the whole tape is given: the three moves take a handful between them. */
const CAP = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the step index at the tape's length when the tape runs out", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    CAP,
    "the three-step tape to run out",
  );

  await h.capture("state", "The step index the run ended on");

  assertEqual(
    ended.run.cause,
    null,
    "the cause of a run over an empty yard whose tape simply ran out " +
      "(specs/program.md)",
  );
  assertEqual(
    ended.run.stepIndex,
    ended.program.length,
    "run.stepIndex on the tick the run ended, against the number of steps " +
      "the tape holds (specs/state.md)",
  );
});
