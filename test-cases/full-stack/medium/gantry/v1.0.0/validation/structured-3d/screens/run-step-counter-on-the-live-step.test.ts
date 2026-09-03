// run/readouts — the step counter reads `step m / n` on the live step.
//
// `specs/ui.md` § Run: "The live step as `step m / n`, with `n` the tape's step
// count and `m` the tape step the run is on, counted from `1`". This check
// decides the general case, on the middle step of a three-step tape: the counter
// counts from `1` while `specs/state.md` counts `stepIndex` from `0`, so the
// screen must read `2 / 3` while the snapshot reads `1`. The two edges — `1 / n`
// before the first tick and `n / n` once every step is complete — are their own
// points.
//
// THE MIDDLE STEP IS REACHED BY LETTING THE TAPE RUN, not by posing an index:
// `stepIndex` is the run's own, and the sweep stops on the first tick that
// reports the second step live.
//
// THE FIGURE IS `m / n`, as `specs/ui.md` writes it, so what is looked for is the
// pair rather than a `2` and a `3` somewhere on the screen: with three steps on
// site `1` of `6`, `2 / 3` is the counter and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { textDraws, toDrawCall, type RecordedOp } from "../case-harness/index";
import { assertEqual, assertLength, assertTrue, fail } from "../assert";
import { GRIP_MAX_RATE, HOIST_MAX_RATE, TROLLEY_MAX_RATE } from "../constants";
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

/** Three steps, so `n` is a figure the rest of the screen does not carry. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 30, rate: GRIP_MAX_RATE }],
  },
  {
    kind: "move",
    commands: [{ axis: "trolley", target: 2, rate: TROLLEY_MAX_RATE }],
  },
  {
    kind: "move",
    commands: [{ axis: "hoist", target: 3, rate: HOIST_MAX_RATE }],
  },
];

/** The step this check reads the counter on, counted as `specs/state.md` does. */
const LIVE_INDEX = 1;

/** Ticks the first step is given before the check calls it a fault. */
const STEP_CAP = 600;

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

it("reads step m / n on the tape step the run is on", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  const started = await startRun(h);
  assertLength(started.program, TAPE.length, "the steps the tape carries");

  const state = await runUntil(
    h,
    (snapshot) => snapshot.run.stepIndex === LIVE_INDEX,
    STEP_CAP,
    "the run to reach the tape's second step",
  );
  assertTrue(
    state.screen === "run" && state.run.phase === "running",
    "the run screen showing a run in progress on the frame the counter is " +
      `read from (screen "${state.screen}", run "${state.run.phase}")`,
  );

  const lines = await readoutLines(h);
  if (!readsCounter(lines, LIVE_INDEX + 1, TAPE.length)) {
    fail(
      `the step counter to read "${LIVE_INDEX + 1} / ${TAPE.length}" while ` +
        `run.stepIndex reads ${LIVE_INDEX}: the counter counts from 1 ` +
        "(specs/ui.md)",
      `the screen's text reads [${lines.map((one) => one.trim()).join(" | ")}]`,
    );
  }

  await h.capture("step-mid", "The step counter mid-tape");
});
