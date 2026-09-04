// run/readouts — the step counter reads `step n / n` once every step is
// complete.
//
// `specs/ui.md` § Run: the live step reads `step m / n`, "and `step n / n` once
// every step is complete". `specs/state.md` fixes the state behind it:
// `stepIndex` "reaches the tape's length once every step is complete". This
// check decides that edge. The general case and the other edge (`1 / n` before
// the first tick) are their own points.
//
// THE RUN HAS TO STILL BE ON THE RUN SCREEN WHEN EVERY STEP IS COMPLETE, and
// that is the whole difficulty of the scenario. `specs/program.md`: "A tick that
// finds no live step and no step left to take is the tick the run ends on:
// cleared if every load is `placed`, otherwise failed as `loads-unplaced`" — and
// a cleared run moves straight to `results` (`specs/ui.md`), so the frame that
// would show `n / n` is a results frame. A failed run, by the same file, "stays
// here". So the yard holds ONE load, which the tape never lifts: the tape runs
// out, the run fails as `loads-unplaced`, and the run screen stands with every
// step complete.
//
// THE LOAD IS PART OF THE SCENARIO RATHER THAN A BYSTANDER. It is what keeps the
// run screen showing at the moment the requirement is about, and it is placed at
// the far end of the yard, well outside `ATTACH_RADIUS` of the hook and clear of
// the crane, with a tape carrying no `attach` — so nothing about it can be
// picked up, struck, or dropped along the way.
//
// EACH STEP ASKS FOR THE SMALLEST GENUINE MOVE OF ITS AXIS. What makes `3 / 3`
// a count rather than a coincidence is that there are three steps on three
// axes, each of which has to be taken, driven and completed; how far any of
// them travels decides nothing here. So each target sits a few hundredths off
// where its axis stands, which `specs/program.md`'s controller still
// accelerates into and arrives at. Travel this reading does not use is only
// more of the axis controller standing between the point and its verdict.
//
// THE FIGURE IS `m / n`, as `specs/ui.md` writes it, so what is looked for is the
// pair rather than a `3` somewhere on the screen.

import { afterEach, beforeEach, it } from "vitest";
import { textDraws, toDrawCall, type RecordedOp } from "../case-harness/index";
import { assertEqual, assertLength, fail } from "../assert";
import {
  GRIP_MAX_RATE,
  HOIST_MAX_RATE,
  HOIST_START,
  TROLLEY_MAX_RATE,
} from "../constants";
import {
  addOneLoad,
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

/** Three steps, none of them an `attach`, each as short as a move can be. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 0.05, rate: GRIP_MAX_RATE }],
  },
  {
    kind: "move",
    commands: [{ axis: "trolley", target: 0.02, rate: TROLLEY_MAX_RATE }],
  },
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 0.02, rate: HOIST_MAX_RATE },
    ],
  },
];

/** The one load: far from the crane, and never touched. */
const LOAD = { x: 10, y: 2, z: 0, yaw: 0 };

/** Ticks the tape is given to run out before the check calls it a fault. */
const END_CAP = 120;

/**
 * Ticks carried in one crossing before the sweep starts looking.
 *
 * The three minimal moves take about twenty ticks between them, and `runUntil`
 * costs a crossing into the page for every tick it polls. Nothing is read
 * before the tape runs out, so the ticks before it can be driven blind.
 */
const CARRY = 12;

/** Runs of text this far apart in `y` are on one line of the readout. */
const LINE_SLOP = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Every line of text the frame the page last drew put on its readout layer. */
async function readoutLines(harness: Harness): Promise<string[]> {
  const ops = (await harness.screenOps()) as RecordedOp[];
  const draws = textDraws(ops.map(toDrawCall));
  const lines: string[] = [];
  for (const draw of draws) {
    const near = draws
      .filter((other) => Math.abs(other.y - draw.y) <= LINE_SLOP)
      .sort((one, two) => one.x - two.x)
      .map((other) => other.text)
      .join(" ");
    if (!lines.includes(near)) lines.push(near);
  }
  return lines;
}

/** Whether some line reads the step counter as `m / n`. */
function readsCounter(lines: readonly string[], m: number, n: number): boolean {
  const wanted = new RegExp(`(?<!\\d)${m}\\s*/\\s*${n}(?!\\d)`);
  return lines.some((line) => wanted.test(line));
}

it("reads step n / n once the tape's last step is complete", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, LOAD, LOAD);
  await poseTape(h, TAPE);
  const started = await startRun(h);
  assertLength(started.program, TAPE.length, "the steps the tape carries");

  await runTicks(h, CARRY);
  const ended = await runUntil(
    h,
    (snapshot) => snapshot.run.phase !== "running",
    END_CAP,
    "the tape to run out",
  );
  assertEqual(
    ended.run.cause,
    "loads-unplaced",
    "the cause a tape that ends with a load unplaced fails as " +
      "(specs/program.md)",
  );
  assertEqual(
    ended.screen,
    "run",
    "the screen a failed run stays on (specs/ui.md)",
  );
  assertEqual(
    ended.run.stepIndex,
    TAPE.length,
    "the step index once every step is complete (specs/state.md)",
  );

  const lines = await readoutLines(h);
  await h.capture("step-last", "The step counter at the end of the tape");

  if (!readsCounter(lines, TAPE.length, TAPE.length)) {
    fail(
      `the step counter to read "${TAPE.length} / ${TAPE.length}" once every ` +
        "step is complete (specs/ui.md)",
      `the screen's text reads [${lines.map((one) => one.trim()).join(" | ")}]`,
    );
  }
});
