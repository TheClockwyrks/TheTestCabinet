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
// THE FIGURE IS `m / n`, as `specs/ui.md` writes it, so what is looked for is the
// pair rather than a `3` somewhere on the screen.

import { afterEach, beforeEach, it } from "vitest";

import { textDraws, toDrawCall } from "../case-harness/index";
import { assertEqual, assertLength, fail } from "../assert";
import {
  GRIP_MAX_RATE,
  HOIST_MAX_RATE,
  TROLLEY_MAX_RATE,
} from "../constants";
import {
  addOneLoad,
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

/** Three steps, none of them an `attach`. */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 30, rate: GRIP_MAX_RATE }] },
  {
    kind: "move",
    commands: [{ axis: "trolley", target: 2, rate: TROLLEY_MAX_RATE }],
  },
  { kind: "move", commands: [{ axis: "hoist", target: 3, rate: HOIST_MAX_RATE }] },
];

/** The one load: far from the crane, and never touched. */
const LOAD = { x: 10, y: 2, z: 0, yaw: 0 };

/** Ticks the tape is given to run out before the check calls it a fault. */
const END_CAP = 1200;

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
  const ops = await harness.screenOps();
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
  if (!readsCounter(lines, TAPE.length, TAPE.length)) {
    fail(
      `the step counter to read "${TAPE.length} / ${TAPE.length}" once every ` +
        "step is complete (specs/ui.md)",
      `the screen's text reads [${lines.map((one) => one.trim()).join(" | ")}]`,
    );
  }

  await h.capture("step-last", "The step counter at the end of the tape");
});
