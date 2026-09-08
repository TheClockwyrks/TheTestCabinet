// screens/build-readout-step-count — the build screen's readouts show how many
// steps the open site's tape holds.
//
// specs/ui.md § Build: "Its readouts show the site's name, the cost against the
// budget, the tool palette with each tool's binding and the selected tool marked,
// and the tape's step count." specs/program.md makes the tape "an ordered list of
// steps", so the count is the number of steps standing in it.
//
// THE READING IS DIFFERENTIAL, and that is what makes it decide the point. A
// build screen carries other figures — the site's number, the cost, the budget,
// the six tool bindings — so "some run carries a 2" would pass a build that draws
// no step count at all. So the tape is read at two lengths and the frame's runs
// are matched by where they were drawn: a readout showing the count is a run that
// says two while the tape holds two steps and three while it holds three, in the
// same place. Nothing else on the build screen changes when a step is appended.
//
// The tape is posed through the tape operations rather than through the program
// screen's widgets, and the build screen is the one read, so a build with a broken
// tape editor still fails or passes this on its readout alone.

import { afterEach, beforeEach, it } from "vitest";
import { drawnFigures, inRun, type DrawnFigures } from "./figures";
import { fail } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Two runs are the same readout when their anchors sit this close. */
const ANCHOR_TOL = 2;

/** A step that asks for nothing unusual: one axis, in range, at a legal rate. */
const STEP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 30, rate: 10 }],
};

/**
 * The figures the last closed frame's text carries, and the runs it spelled,
 * each with where it landed.
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
 * read for the letter-spaced figure above.
 */
async function frameFigures(harness: Harness): Promise<DrawnFigures> {
  return drawnFigures(await harness.screenCalls());
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the tape's step count on the build screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseTape(h, [STEP, STEP]);
  await h.advance(1);
  const atTwo = await frameFigures(h);
  await h.capture("build-steps", "The step-count readout");

  await poseTape(h, [STEP]);
  await h.advance(1);
  const atThree = await frameFigures(h);

  // Each candidate readout is read on its own — the run, and the draws that
  // spelled it — rather than the whole frame, because what identifies the step
  // count is that ONE readout says two and then three. `inRun` is what scopes a
  // reading to a single readout.
  const readout = atTwo.runs.find((two) =>
    atThree.runs.some(
      (three) =>
        Math.abs(three.x - two.x) <= ANCHOR_TOL &&
        Math.abs(three.y - two.y) <= ANCHOR_TOL &&
        atTwo.where(inRun(two)).includes(2) &&
        atThree.where(inRun(three)).includes(3),
    ),
  );

  if (readout === undefined) {
    fail(
      "the build screen to draw the tape's step count, so one readout says " +
        "two while the tape holds two steps and three while it holds three " +
        "(specs/ui.md § Build)",
      `with two steps it drew ` +
        `${JSON.stringify(atTwo.runs.map((run) => run.text))} and with three ` +
        `${JSON.stringify(atThree.runs.map((run) => run.text))}`,
    );
  }
});
