// run/readouts — while a command is live, the run screen shows that axis's
// target.
//
// `specs/ui.md` § Run: the run screen's readouts show "Each axis's value and its
// command's target while one is live". This check decides the second half of
// that sentence in the affirmative direction: an axis carrying a live command
// has that command's target on screen. The negative direction — an axis with no
// live command showing no target — is its own check.
//
// THE TAPE PUTS THE THREE OTHER AXES SOMEWHERE FIRST so the target under test
// cannot be read off anything else. Its first step drives the trolley, the hoist
// and the grip to three settled values; its second commands the slew to `253`, a
// figure no other readout on the run screen carries and one the slew is nowhere
// near at the tick this reads. So the only way `253` reaches the screen is as
// the slew's live command target.
//
// THE SETTLED VALUES ARE THE NEAREST ONES THAT WILL DO. All the settling step
// has to leave behind is three figures that are not `253`; how far its axes
// travel to reach them decides nothing, and travel this reading does not use is
// only more of the axis controller standing between the point and its verdict.
//
// THE FIGURE IS LOOKED FOR ON THE SLEW'S OWN LINE. `specs/ui.md` puts the target
// beside its axis's value, so a readout that names the axis fixes the line, and
// the target has to be on it — which is also what stops another axis's readout
// from standing in for the one under test.

import { afterEach, beforeEach, it } from "vitest";
import { drawnTextRuns, type TextDraw } from "../case-harness/text";
import { drawnFigures, type DrawnFigure } from "./figures";
import { assertEqual, assertTrue, fail } from "../assert";
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
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The slew target the second step commands: on nothing else the screen shows. */
const SLEW_TARGET = 253;

/** The settling step, then the one command this check is about. */
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
    commands: [{ axis: "slew", target: SLEW_TARGET, rate: SLEW_MAX_RATE }],
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

/** How far a drawn figure may sit from the target it reads: whole units. */
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
  /**
   * The runs on that baseline, left to right, joined with a space each.
   *
   * Joined only to be READ BACK in a failure message and to be searched for the
   * axis's name — never for its figures, which come off `./figures` and so are
   * never fused across the space this join writes.
   */
  readonly text: string;
  /** Every figure drawn on that baseline. */
  readonly figures: number[];
}

/** The readout line the named axis is drawn on. */
function axisLine(read: ReadoutReading, axis: string): AxisLine {
  const named = read.runs.find((draw) =>
    draw.text.toLowerCase().includes(axis),
  );
  if (named === undefined) {
    fail(
      `the run screen to name the ${axis} axis, so its target reads as that ` +
        "axis's (specs/ui.md)",
      `no run of drawn text carries "${axis}": ` +
        `[${read.runs.map((draw) => draw.text.trim()).join(" | ")}]`,
    );
  }
  return {
    text: read.runs
      .filter((draw) => Math.abs(draw.y - named.y) <= LINE_SLOP)
      .sort((one, two) => one.x - two.x)
      .map((draw) => draw.text)
      .join(" "),
    figures: read.figures
      .filter((figure) => Math.abs(figure.run.y - named.y) <= LINE_SLOP)
      .map((figure) => figure.value),
  };
}

it("draws the live command's target on that axis's readout", async () => {
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
  assertEqual(
    state.run.axes.slew.command?.target,
    SLEW_TARGET,
    "the target the slew's live command carries (specs/program.md)",
  );

  const line = axisLine(await readoutText(h), "slew");
  const shown = line.figures.some(
    (figure) => Math.abs(figure - SLEW_TARGET) <= FIGURE_TOL,
  );
  await h.capture("run-target", "The live command target");

  if (!shown) {
    fail(
      `the slew's live command target, ${SLEW_TARGET}, drawn on the slew's ` +
        "own readout line (specs/ui.md)",
      `that line reads "${line.text.trim()}"`,
    );
  }
});
