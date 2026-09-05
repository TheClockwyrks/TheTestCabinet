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
// WHAT IS POSED IS THE GRIP'S STARTING VALUE, a tenth of a degree short of
// where the first step sends it. The first step is the route to the second
// rather than the point, and `setAxis` "takes any value the axis can hold",
// leaving the axis stopped with no live command (specs/instrumentation.md) —
// and nothing has ticked when it is called, so the tick that takes the step
// issues exactly the command it would have issued anyway and drives the axis to
// its target itself. Only the distance is short, so the sweep below is a
// handful of ticks rather than the seventy a full thirty-degree turn takes.
// Driving that turn would put the grip controller between this check and the
// counter it reads, which is another point's requirement.
//
// THE FIGURE IS `m / n`, as `specs/ui.md` writes it, so what is looked for is the
// pair rather than a `2` and a `3` somewhere on the screen: with three steps on
// site `1` of `6`, `2 / 3` is the counter and nothing else.

import { afterEach, beforeEach, it } from "vitest";

import { textDraws, toDrawCall } from "../case-harness/index";
import { assertLength, assertTrue, fail } from "../assert";
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

/** Where the first step sends the grip, and how far short of it it starts. */
const FIRST_GRIP = 30;
const NEAR = 0.1;

/** Three steps, so `n` is a figure the rest of the screen does not carry. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: FIRST_GRIP, rate: GRIP_MAX_RATE }],
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
const STEP_CAP = 90;

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

/**
 * The separators a build may set between a figure's digit triples.
 *
 * ASCII space is deliberately absent: a line here is made by joining the frame's
 * separate runs of text with one, so accepting it would read the two figures in
 * `40 130` as the single number 40130. `.` is absent for the same sort of
 * reason — it is the decimal point, and a build drawing `1.5` means one and a
 * half.
 */
const GROUP_SEPARATORS = [",", "'", "\u00A0", "\u202F", "\u2009"];

/**
 * Every conventional way a build might write the whole figure `value`.
 *
 * A figure of three digits or fewer has the one rendering; a longer one is also
 * written grouped, which is what `Number.prototype.toLocaleString` does by
 * default. Reading every rendering is what lets a build that draws `1234` and a
 * build that draws `1,234` grade the same.
 */
function renderings(value: number): string[] {
  const plain = String(value);
  const grouped = GROUP_SEPARATORS.map((separator) =>
    plain.replace(/\B(?=(\d{3})+$)/g, separator),
  );
  return [plain, ...grouped.filter((one) => one !== plain)];
}

/** `text` with every regular-expression metacharacter escaped. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether some line reads the step counter as `m / n`. */
function readsCounter(lines: readonly string[], m: number, n: number): boolean {
  return renderings(m).some((left) =>
    renderings(n).some((right) => {
      const wanted = new RegExp(
        `(?<!\\d)${escapeRegExp(left)}\\s*/\\s*${escapeRegExp(right)}(?!\\d)`,
      );
      return lines.some((line) => wanted.test(line));
    }),
  );
}

it("reads step m / n on the tape step the run is on", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  const started = await startRun(h);
  assertLength(started.program, TAPE.length, "the steps the tape carries");

  await h.debug.setAxis("grip", FIRST_GRIP - NEAR);

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
  await h.capture("step-mid", "The step counter mid-tape");

  if (!readsCounter(lines, LIVE_INDEX + 1, TAPE.length)) {
    fail(
      `the step counter to read "${LIVE_INDEX + 1} / ${TAPE.length}" while ` +
        `run.stepIndex reads ${LIVE_INDEX}: the counter counts from 1 ` +
        "(specs/ui.md)",
      `the screen's text reads [${lines.map((one) => one.trim()).join(" | ")}]`,
    );
  }
});
