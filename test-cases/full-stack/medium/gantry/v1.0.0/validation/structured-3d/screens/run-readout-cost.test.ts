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
import { drawnFigures, type DrawnFigures } from "./figures";
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
 * The figures the last closed frame's text carries, and the runs it spelled.
 *
 * specs/overview.md fixes where a readout lives — "over it the screen-space
 * readouts are drawn on a 2D layer composited on top of the picture, laid out
 * in logical stage units" — so what a screen shows is the text that layer's
 * frame issued, whatever font, colour, or arrangement a build chose for it.
 *
 * The figures come from `./figures`, this project's one reading of a number on
 * the screen, and it reads the frame's raw draws and its coalesced logical runs
 * TOGETHER, because neither half alone answers a check like this one. A build
 * that letter-spaces a figure draws a glyph per `fillText` — the only portable
 * way to letter-space canvas text — so its figure exists only once the glyphs
 * are put back together into a run. A build that groups a figure with a space
 * inside ONE call, which is what this case's own reference does, has a figure
 * the runs cannot be read for: the merge writes an ASCII space of its own
 * wherever it crosses a word gap, so a run's spaces are not all the build's and
 * a reading of the runs may not treat one as a separator. `screenCalls` carries
 * the measured geometry that merge needs.
 */
async function readoutFigures(harness: Harness): Promise<DrawnFigures> {
  return drawnFigures(await harness.screenCalls());
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

  const drawn = await readoutFigures(h);
  const shown = drawn.all.some(
    (figure) => Math.abs(figure - cost) <= FIGURE_TOL,
  );
  await h.capture("run-cost", "The cost readout on the run screen");

  if (!shown) {
    fail(
      `the crane's cost, ${cost.toFixed(2)}, drawn on the run screen ` +
        "(specs/ui.md)",
      `the screen's text reads ` +
        `[${drawn.runs.map((run) => run.text.trim()).join(" | ")}]`,
    );
  }
});
