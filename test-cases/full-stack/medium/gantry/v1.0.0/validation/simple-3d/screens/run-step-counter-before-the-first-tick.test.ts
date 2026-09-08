// run/readouts — the step counter reads `step 1 / n` before the first tick takes
// a step.
//
// `specs/ui.md` § Run: "The live step as `step m / n`, with `n` the tape's step
// count and `m` the tape step the run is on, counted from `1`: it reads
// `step 1 / n` before the first tick takes a step and `step n / n` once every
// step is complete." This check decides the first of those two edges. The
// general case (`m / n` on the live step) and the other edge (`n / n` once every
// step is complete) are their own points.
//
// `specs/state.md` fixes the state that edge names: a run starts with
// "`stepIndex`, `stepLive` — `0` and `false`: the first tick is what takes the
// first step". So the counter is read while `run.stepIndex` is `0`, which the
// snapshot is asked for beside the drawing.
//
// ONE TICK IS DRIVEN BEFORE THE READING, and it has to be. A run screen is drawn
// by a frame, `startRun` takes no tick of its own (`specs/state.md`: "nothing has
// ticked at the call"), and the first frame of the run is the first frame after
// it. That frame's tick takes the tape's first step, which leaves `stepIndex` at
// `0` — the step is live, not complete — so the state the reading is taken
// against is exactly the one the requirement names.
//
// THE FIGURE IS `m / n`, as `specs/ui.md` writes it, so what is looked for is the
// pair rather than a `1` and a `3` somewhere on the screen: with three steps on
// site `1` of `6`, `1 / 3` is the counter and nothing else.

import { afterEach, beforeEach, it } from "vitest";

import { drawnTextRuns } from "../case-harness/index";
import { assertEqual, assertLength, assertTrue, fail } from "../assert";
import { GRIP_MAX_RATE, HOIST_MAX_RATE, TROLLEY_MAX_RATE } from "../constants";
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

/** Runs of text this far apart in `y` are on one line of the readout. */
const LINE_SLOP = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Every line of text the frame the page last drew put on its readout layer.
 *
 * The runs are the LOGICAL ones the frame spells, each placed where its first
 * draw was, never the `fillText` split: a build that letter-spaces a label or
 * a figure draws a glyph per call, which is the only portable way to
 * letter-space canvas text, and a line assembled from those glyphs reads `1 2`
 * where the screen says `12`. `screenCalls` carries the measured geometry the
 * shared merge rule (`case-harness/text.ts`) needs to put side-by-side glyphs
 * on one baseline back together, and every raw string is a substring of its
 * run, so coalescing can only add a match.
 */
async function readoutLines(harness: Harness): Promise<string[]> {
  const draws = drawnTextRuns(await harness.screenCalls());
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

it("reads step 1 / n before the first tick has taken a step", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  const started = await startRun(h);
  assertLength(started.program, TAPE.length, "the steps the tape carries");
  assertEqual(
    started.run.stepIndex,
    0,
    "the step index a run starts on (specs/state.md)",
  );
  assertEqual(started.run.tick, 0, "the ticks a run has taken at its start");

  const state = await runTicks(h, 1);
  assertTrue(
    state.screen === "run" && state.run.phase === "running",
    "the run screen showing a run in progress on the frame the counter is " +
      `read from (screen "${state.screen}", run "${state.run.phase}")`,
  );
  assertEqual(
    state.run.stepIndex,
    0,
    "the step index the tape's first step is taken on: the step is live, not " +
      "complete (specs/state.md)",
  );

  const lines = await readoutLines(h);
  await h.capture("step-first", "The step counter before the first tick");

  if (!readsCounter(lines, 1, TAPE.length)) {
    fail(
      `the step counter to read "1 / ${TAPE.length}" before the first tick ` +
        "has taken a step (specs/ui.md)",
      `the screen's text reads [${lines.map((one) => one.trim()).join(" | ")}]`,
    );
  }
});
