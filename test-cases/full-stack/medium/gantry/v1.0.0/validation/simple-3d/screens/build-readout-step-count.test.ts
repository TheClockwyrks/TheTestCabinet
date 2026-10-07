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
import { figureRuns, figuresIn } from "./figures";
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
 * Every run of text the last closed frame drew, with where it landed.
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
 * Each run comes back carrying the raw draws that spelled it as well, because
 * a figure is read off BOTH (`./figures`): a space the BUILD wrote inside one
 * draw groups the figure it sits in — this case's own reference sets a cost
 * that way — while a space the MERGE wrote between two draws groups nothing,
 * since the two figures either side of it were drawn apart.
 */
async function frameDraws(harness: Harness) {
  return figureRuns(await harness.screenCalls());
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
  // and then the second, and never both at once.
  const readout = atTwo.find((two) => {
    const before = figuresIn(two);
    if (!before.includes(FIRST) || before.includes(THEN)) return false;
    return atThree.some((three) => {
      const after = figuresIn(three);
      return (
        Math.abs(three.x - two.x) <= ANCHOR_TOL &&
        Math.abs(three.y - two.y) <= ANCHOR_TOL &&
        after.includes(THEN) &&
        !after.includes(FIRST)
      );
    });
  });

  if (readout === undefined) {
    fail(
      "the build screen to draw the tape's step count, so one readout says " +
        `${FIRST} while the tape holds ${FIRST} steps and ${THEN} while it ` +
        `holds ${THEN} (specs/ui.md § Build)`,
      `with ${FIRST} steps it drew ` +
        `${JSON.stringify(atTwo.map((d) => d.text))} and with ${THEN} ` +
        `${JSON.stringify(atThree.map((d) => d.text))}`,
    );
  }
});
