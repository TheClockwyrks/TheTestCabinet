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
// says `FIRST` while the tape holds that many steps and `THEN` once one more is
// appended, in the same place, and says neither count at the other length.
// Nothing else on the build screen changes when a step is appended. Both lengths
// lie past the palette's six bindings, because a run that lists several tools —
// "1 STRUT 2 CABLE 3 RAIL" — holds several small figures at one anchor on both
// frames, and a count that changes is what tells the step count from it.
//
// The tape is posed through the tape operations rather than through the program
// screen's widgets, and the build screen is the one read, so a build with a broken
// tape editor still fails or passes this on its readout alone.

import { afterEach, beforeEach, it } from "vitest";
import { drawnTextLines } from "../case-harness/index";
import { fail } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  type Harness,
  type TapeStepSpec,
} from "../harness";
import { drawnFigures, type DrawnFigure } from "./figures";

/** Two runs are the same readout when their anchors sit this close. */
const ANCHOR_TOL = 2;

/** The tape's length at the first reading: past the palette's six bindings. */
const FIRST = 7;

/** And at the second, one step appended. */
const THEN = FIRST + 1;

/** A step that asks for nothing unusual: one axis, in range, at a legal rate. */
const STEP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 30, rate: 10 }],
};

/**
 * Every figure the last closed frame drew, with the run it was drawn in and
 * where that run landed, and the words the same frame spells.
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
 * The figures come off those same operations through `./figures`, this
 * directory's one reading of a number, which reads the merged runs and the raw
 * draws they were coalesced from together — so a count a build grouped with a
 * plain space inside one `fillText` reads as the count — and places every
 * figure at its RUN, which is the anchor this differential matches on.
 */
interface FrameReading {
  /** Every logical run the frame spelled, in reading order. */
  readonly lines: string[];
  /** Every figure those runs show, placed at the run it was read inside. */
  readonly figures: DrawnFigure[];
}

async function frameDraws(harness: Harness): Promise<FrameReading> {
  const calls = await harness.screenCalls();
  return { lines: drawnTextLines(calls), figures: drawnFigures(calls) };
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
  await poseTape(
    h,
    Array.from({ length: FIRST }, () => STEP),
  );
  await h.advance(1);
  const atTwo = await frameDraws(h);
  await h.capture("build-steps", "The step-count readout");

  await poseTape(h, [STEP]);
  await h.advance(1);
  const atThree = await frameDraws(h);

  // What identifies the step count is that ONE readout says the first count
  // and then the second, and never both at once. `drawnFigures` places every
  // figure of a run at that one run object, so a run's figures are the ones
  // sharing its `run`.
  const holds = (
    figures: readonly (typeof atTwo.figures)[number][],
    run: (typeof atTwo.figures)[number]["run"],
    value: number,
  ): boolean =>
    figures.some((figure) => figure.run === run && figure.value === value);
  const readout = atTwo.figures.find(
    (two) =>
      two.value === FIRST &&
      !holds(atTwo.figures, two.run, THEN) &&
      atThree.figures.some(
        (three) =>
          three.value === THEN &&
          !holds(atThree.figures, three.run, FIRST) &&
          Math.abs(three.run.x - two.run.x) <= ANCHOR_TOL &&
          Math.abs(three.run.y - two.run.y) <= ANCHOR_TOL,
      ),
  );

  if (readout === undefined) {
    fail(
      "the build screen to draw the tape's step count, so one readout says " +
        `${FIRST} while the tape holds ${FIRST} steps and ${THEN} while it ` +
        `holds ${THEN} (specs/ui.md § Build)`,
      `with ${FIRST} steps it drew ${JSON.stringify(atTwo.lines)} ` +
        `and with ${THEN} ${JSON.stringify(atThree.lines)}`,
    );
  }
});
