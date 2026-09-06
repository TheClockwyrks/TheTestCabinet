// run/readouts — the run screen shows the value of each of the four axes.
//
// `specs/ui.md` § Run lists the run screen's readouts "over the live scene", the
// first of them being "Each axis's value and its command's target while one is
// live". This check decides the first half of that sentence for all four axes:
// `slew`, `trolley`, `hoist` and `grip` (`specs/program.md`) each have their
// value on screen while the tape plays.
//
// THE FOUR VALUES COME FROM ONE MOVE STEP THAT COMMANDS ALL FOUR AXES, which
// `specs/program.md` allows ("one or more commands, at most one per axis"), and
// they are read back off the snapshot rather than posed. `setAxis` would be the
// shorter route, but posing the trolley or the hoist mid-run moves the pivot or
// the cable a whole unit between two ticks, and the pendulum that follows
// (`specs/rigging.md`) snaps the cable and ends the run — a scenario that graded
// the readouts off a run that had already failed. Driving the axes instead
// leaves the run in progress and every axis at a value of its own.
//
// THE READING IS TAKEN EARLY, while every axis is still a long way from its
// target, so a screen that drew the four TARGETS and no value could not pass.
//
// EACH VALUE IS LOOKED FOR ON A LINE THAT NAMES ITS OWN AXIS rather than
// anywhere on the screen. A readout that shows "each axis's value" names the axis
// it belongs to, so a run of text carrying the axis's name fixes a line and the
// figure has to be on one of those lines. That is what keeps one axis's value
// from being read as another's, and it is why the tolerance below can be as loose
// as a build rounding to whole units needs.
//
// EVERY LINE THAT NAMES THE AXIS IS CONSIDERED, not the first one drawn. A run
// screen is free to draw more than one thing that names an axis — `specs/ui.md`
// fixes the readouts it must carry and forbids nothing else, and a build that
// also writes out the live step's commands names all four axes in that one line.
// Taking the first would grade the order a build happens to draw its readouts in,
// which no part of the specification fixes.

import { afterEach, beforeEach, it } from "vitest";

import { drawnTextRuns, type TextDraw } from "../case-harness/text";
import { drawnFigures, type DrawnFigure } from "./figures";
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
  standMinimalCrane,
  startRun,
  type AxisName,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The four axes `specs/program.md` tabulates, in that order. */
const AXES: readonly AxisName[] = ["slew", "trolley", "hoist", "grip"];

/**
 * One move step commanding all four axes, each a long way off.
 *
 * The trolley's `3` is inside the minimal crane's four-unit track
 * (`specs/structure.md`), and every rate is the axis's own maximum
 * (`specs/program.md`), so half a second of run leaves the four axes at four
 * clearly different values, none of them near its target.
 */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "slew", target: 253, rate: SLEW_MAX_RATE },
      { axis: "trolley", target: 3, rate: TROLLEY_MAX_RATE },
      { axis: "hoist", target: 5, rate: HOIST_MAX_RATE },
      { axis: "grip", target: 137, rate: GRIP_MAX_RATE },
    ],
  },
];

/** Ticks into the run: half a second, well clear of its first frame. */
const SETTLE = 30;

/**
 * How far a drawn figure may sit from the value it reads.
 *
 * `specs/ui.md` fixes that the value is shown and not how it is written, so a
 * build is free to round it. Half a unit is the coarsest rounding — to whole
 * units — and nothing looser is needed, because every axis is more than a unit
 * from its own target at the tick this reads.
 */
const FIGURE_TOL = 0.5;

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
 * What the frame the page last drew put on its readout layer: the runs of text
 * it spells, and the figures those runs show.
 *
 * The runs are the LOGICAL ones the frame spells, each placed where its first
 * draw was, never the `fillText` split: a build that letter-spaces a label or
 * a figure draws a glyph per call, which is the only portable way to
 * letter-space canvas text, and a line assembled from those glyphs reads `1 2`
 * where the screen says `12`. `screenCalls` carries the measured geometry the
 * shared merge rule (`case-harness/text.ts`) needs to put side-by-side glyphs
 * on one baseline back together, and every raw string is a substring of its
 * run, so coalescing can only add a match.
 *
 * The FIGURES come off the same operations through `./figures`, this
 * directory's one reading of a number, which reads the merged runs and the raw
 * draws they were coalesced from together — so a figure a build grouped with a
 * plain space inside one `fillText` reads as the figure, while the space the
 * merge itself writes between two draws still separates two of them. Every
 * figure keeps the run it was read inside, which is what puts it on a baseline
 * and so on one axis's readout line rather than loose on the screen.
 */
interface ReadoutReading {
  /** Every logical run the frame spelled, placed where it was drawn. */
  readonly runs: TextDraw[];
  /** Every figure those runs show, each carrying its run. */
  readonly figures: DrawnFigure[];
}

async function readoutText(harness: Harness): Promise<ReadoutReading> {
  const calls = await harness.screenCalls();
  return { runs: drawnTextRuns(calls), figures: drawnFigures(calls) };
}

/** One readout line: everything drawn on a baseline, and the figures on it. */
interface AxisLine {
  /** The runs on that baseline, left to right, joined with a space each.
   *
   * Joined only to be READ BACK in a failure message and to be searched for the
   * axis's name — never for its figures, which come off `./figures` and so are
   * never fused across the space this join writes.
   */
  readonly text: string;
  /** Every figure drawn on that baseline. */
  readonly figures: number[];
}

/** Every readout line the axis's name is drawn on. */
function axisLines(read: ReadoutReading, axis: AxisName): AxisLine[] {
  const named = read.runs.filter((draw) =>
    draw.text.toLowerCase().includes(axis),
  );
  if (named.length === 0) {
    fail(
      `the run screen to name the ${axis} axis, so its value reads as that ` +
        "axis's (specs/ui.md)",
      `no run of drawn text carries "${axis}": ` +
        `[${read.runs.map((draw) => draw.text.trim()).join(" | ")}]`,
    );
  }
  const lines = new Map<number, AxisLine>();
  for (const anchor of named) {
    lines.set(Math.round(anchor.y), {
      text: read.runs
        .filter((draw) => Math.abs(draw.y - anchor.y) <= LINE_SLOP)
        .sort((one, two) => one.x - two.x)
        .map((draw) => draw.text)
        .join(" "),
      figures: read.figures
        .filter((figure) => Math.abs(figure.run.y - anchor.y) <= LINE_SLOP)
        .map((figure) => figure.value),
    });
  }
  return [...lines.values()];
}

it("draws every one of the four axes' values on the run screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);
  const state = await runTicks(h, SETTLE);

  assertTrue(
    state.screen === "run" && state.run.phase === "running",
    "the run screen showing a run in progress, so its readouts are the ones " +
      `specs/ui.md lists (screen "${state.screen}", run "${state.run.phase}")`,
  );

  const draws = await readoutText(h);
  await h.capture("run-axes", "The four axis values");

  for (const axis of AXES) {
    const value = state.run.axes[axis].value;
    const lines = axisLines(draws, axis);
    const shown = lines.some((line) =>
      line.figures.some((figure) => Math.abs(figure - value) <= FIGURE_TOL),
    );
    if (!shown) {
      fail(
        `the ${axis} axis's value, ${value.toFixed(2)}, drawn on a readout ` +
          "line that names that axis (specs/ui.md)",
        `the ${lines.length} line(s) naming it read ` +
          `[${lines.map((line) => line.text.trim()).join(" | ")}]`,
      );
    }
  }
});
