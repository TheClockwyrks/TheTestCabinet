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

import { toDrawCall } from "../case-harness/draw-calls";
import { textDraws, type TextDraw } from "../case-harness/text";
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

/** Every run of text the frame the page last drew put on its readout layer. */
async function readoutText(harness: Harness): Promise<TextDraw[]> {
  const ops = await harness.screenOps();
  return textDraws(ops.map(toDrawCall));
}

/** Every number a run of text carries, group separators closed up first. */
function numbersIn(text: string): number[] {
  const joined = text.replace(/(?<=\d)[\s,](?=\d)/g, "");
  return (joined.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** Every readout line the axis's name is drawn on, each as one string. */
function axisLines(draws: readonly TextDraw[], axis: AxisName): string[] {
  const named = draws.filter((draw) => draw.text.toLowerCase().includes(axis));
  if (named.length === 0) {
    fail(
      `the run screen to name the ${axis} axis, so its value reads as that ` +
        "axis's (specs/ui.md)",
      `no run of drawn text carries "${axis}": ` +
        `[${draws.map((draw) => draw.text.trim()).join(" | ")}]`,
    );
  }
  const lines = new Map<number, string>();
  for (const anchor of named) {
    lines.set(
      Math.round(anchor.y),
      draws
        .filter((draw) => Math.abs(draw.y - anchor.y) <= LINE_SLOP)
        .sort((one, two) => one.x - two.x)
        .map((draw) => draw.text)
        .join(" "),
    );
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
      numbersIn(line).some((figure) => Math.abs(figure - value) <= FIGURE_TOL),
    );
    if (!shown) {
      fail(
        `the ${axis} axis's value, ${value.toFixed(2)}, drawn on a readout ` +
          "line that names that axis (specs/ui.md)",
        `the ${lines.length} line(s) naming it read ` +
          `[${lines.map((line) => line.trim()).join(" | ")}]`,
      );
    }
  }
});
