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
// EACH LINE IS THE ONE ITS AXIS IS NAMED ON, and the reading is of the WHOLE
// line: a target drawn beside the value would put a second figure there, and
// that is exactly what this refuses.

import { afterEach, beforeEach, it } from "vitest";
import type { TextDraw } from "../case-harness/text";
import { alongBaseline, drawnFigures, type DrawnFigures } from "./figures";
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
 * The figures the frame the page last drew put on its readout layer, and the
 * runs it spelled.
 *
 * The runs are the LOGICAL ones the frame spells, each placed where its first
 * draw was, never the `fillText` split: a build that letter-spaces a label or
 * a figure draws a glyph per call, which is the only portable way to
 * letter-space canvas text, and a line assembled from those glyphs reads `1 2`
 * where the screen says `12`. `screenCalls` carries the measured geometry the
 * shared merge rule (`case-harness/text.ts`) needs to put side-by-side glyphs
 * on one baseline back together.
 *
 * The figures come from `./figures`, this project's one reading of a number on
 * the screen, which reads those runs together with the RAW draws underneath
 * them. The runs alone cannot be read for a figure a space groups, because the
 * merge writes an ASCII space of its own wherever it crosses a word gap and a
 * run's spaces are therefore not all the build's; the raw draws alone cannot be
 * read for the letter-spaced figure above. Read together, a figure either one
 * carries is a figure the frame drew.
 */
async function readoutFigures(harness: Harness): Promise<DrawnFigures> {
  return drawnFigures(await harness.screenCalls());
}

/**
 * One readout line: the text it spells, and the baseline it is drawn on.
 *
 * The baseline is kept beside the text because the line is READ twice — once as
 * copy, for the axis it names, and once for the figures on it — and the second
 * reading is scoped by where the text sits rather than by the string the first
 * reading built.
 */
interface Line {
  readonly text: string;
  readonly y: number;
}

/** The readout line the named axis is drawn on. */
function axisLine(runs: readonly TextDraw[], axis: string): Line {
  const named = runs.find((run) => run.text.toLowerCase().includes(axis));
  if (named === undefined) {
    fail(
      `the run screen to name the ${axis} axis, so what is drawn beside it ` +
        "reads as that axis's (specs/ui.md)",
      `no run of drawn text carries "${axis}": ` +
        `[${runs.map((run) => run.text.trim()).join(" | ")}]`,
    );
  }
  return {
    text: runs
      .filter((run) => Math.abs(run.y - named.y) <= LINE_SLOP)
      .sort((one, two) => one.x - two.x)
      .map((run) => run.text)
      .join(" "),
    y: named.y,
  };
}

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

  const frame = await readoutFigures(h);
  await h.capture("axis-readout", "The axis readouts with one command live");

  for (const axis of QUIET) {
    const value = state.run.axes[axis].value;
    const line = axisLine(frame.runs, axis);
    // The figures of that LINE, scoped by the baseline it was found on. The
    // reading is `./figures`' union of the coalesced runs and the raw draws,
    // which is what makes this refusal a refusal of FIGURES rather than of
    // draws: the raw half adds only what an ASCII space inside one call
    // groups, so a build that letter-spaces `1.0u` a glyph per `fillText` is
    // still read as carrying the one figure `1.0` and not the two `1` and `0`.
    const stray = frame
      .where(alongBaseline(line.y, LINE_SLOP))
      .filter((figure) => Math.abs(figure - value) > FIGURE_TOL);
    if (stray.length > 0) {
      fail(
        `the ${axis} axis's readout to carry its value, ` +
          `${value.toFixed(2)}, and no target: no command is live on it ` +
          "(specs/ui.md)",
        `that line reads "${line.text.trim()}", carrying ` +
          `[${stray.join(", ")}] besides`,
      );
    }
  }
});
