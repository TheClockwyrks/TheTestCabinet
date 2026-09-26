// run/readouts — the run screen shows the cost of the crane the run is made with.
//
// `specs/ui.md` § Run lists "The run clock, in seconds, and the crane's cost"
// among the run screen's readouts. The cost itself is the structure's
// (`specs/structure.md`), and `specs/state.md` has it derived from
// `sites[siteIndex].structure`, so the figure this check looks for is the one the
// build's own snapshot reports as `structure.cost` — the readout is graded
// against the crane on the site rather than against a number this file chose.
//
// THE CRANE IS THE MINIMAL ONE, whose cost is a three-figure number no other
// readout on the run screen carries: the clock is a fraction of a second at the
// tick this reads, the step counter is `1 / 1`, the site is `1 / 6`, and the four
// axes are at the run-start posture.
//
// THE TOLERANCE IS A WHOLE UNIT, because `specs/ui.md` fixes that the cost is
// shown and not how it is written: a build rounding the cost to whole force-free
// units is writing the same figure.

import { afterEach, beforeEach, it } from "vitest";

import { figureRuns, figuresAcross, type FigureRun } from "./figures";
import { assertGreaterThan, assertTrue, fail } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
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

/** Something for the run to be doing while the cost is read. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: 253, rate: SLEW_MAX_RATE }],
  },
];

/** A whole force-free unit: the coarsest rounding a build could write. */
const FIGURE_TOL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Every run of text the frame the page last drew put on its readout layer.
 *
 * Read off the LOGICAL RUNS the frame spells, never off the `fillText` split:
 * a build that letter-spaces its copy draws a glyph per call, which is the only
 * portable way to letter-space canvas text, and the specification fixes the
 * words a screen shows while leaving their spacing to the build. `screenCalls`
 * carries the measured geometry the shared merge rule (`case-harness/text.ts`)
 * needs to put side-by-side glyphs on one baseline back together, and every
 * raw string is a substring of its run, so coalescing can only add a match.
 *
 * Each run comes back carrying the raw draws that spelled it as well, because
 * a figure is read off BOTH (`./figures`): a space the BUILD wrote inside one
 * draw groups the figure it sits in — this case's own reference sets a cost
 * that way — while a space the MERGE wrote between two draws groups nothing,
 * since the two figures either side of it were drawn apart.
 */
async function readoutText(harness: Harness): Promise<FigureRun[]> {
  return figureRuns(await harness.screenCalls());
}

it("draws the crane's cost on the run screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);
  const state = await runTicks(h, 1);

  assertTrue(
    state.screen === "run" && state.run.phase === "running",
    "the run screen showing a run in progress, so its readouts are the ones " +
      `specs/ui.md lists (screen "${state.screen}", run "${state.run.phase}")`,
  );
  const cost = state.structure.cost;
  assertGreaterThan(
    cost,
    0,
    "the cost of the crane the run is being made with (specs/structure.md)",
  );

  const drawn = await readoutText(h);
  const shown = figuresAcross(drawn).some(
    (figure) => Math.abs(figure - cost) <= FIGURE_TOL,
  );
  await h.capture("run-cost", "The cost readout on the run screen");

  if (!shown) {
    fail(
      `the crane's cost, ${cost.toFixed(2)}, drawn on the run screen ` +
        "(specs/ui.md)",
      `the screen's text reads [${drawn
        .map((one) => one.text.trim())
        .join(" | ")}]`,
    );
  }
});
