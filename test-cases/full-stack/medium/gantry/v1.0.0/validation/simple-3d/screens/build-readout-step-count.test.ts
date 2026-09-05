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
import { textDraws, toDrawCall } from "../case-harness/index";
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

/** Every run of text the last closed frame drew, with where it landed. */
async function frameDraws(harness: Harness) {
  const ops = await harness.screenOps();
  return textDraws(ops.map(toDrawCall));
}

/**
 * The separators a build may set between a figure's digit triples.
 *
 * ASCII space is deliberately absent: a frame's text is assembled by joining
 * separate draw runs with one, so accepting it would read the two figures in
 * `40 130` as the single number 40130. `.` is absent for the same sort of
 * reason — it is the decimal point, and a build drawing `1.5` means one and a
 * half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One drawn number: a grouped figure, or a plain one. */
const DRAWN = new RegExp(
  `\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?`,
  "g",
);

/**
 * Every number a run carries.
 *
 * A grouped figure reads as the one figure it is, so `1,234` and `1234` both
 * come back as 1234 and a build is free to group the figure it draws.
 */
function numbersIn(text: string): number[] {
  return (text.match(DRAWN) ?? []).map((one) =>
    Number(one.replace(new RegExp(GROUP, "g"), "")),
  );
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
  const atTwo = await frameDraws(h);
  await h.capture("build-steps", "The step-count readout");

  await poseTape(h, [STEP]);
  await h.advance(1);
  const atThree = await frameDraws(h);

  const readout = atTwo.find((two) =>
    atThree.some(
      (three) =>
        Math.abs(three.x - two.x) <= ANCHOR_TOL &&
        Math.abs(three.y - two.y) <= ANCHOR_TOL &&
        numbersIn(two.text).includes(2) &&
        numbersIn(three.text).includes(3),
    ),
  );

  if (readout === undefined) {
    fail(
      "the build screen to draw the tape's step count, so one readout says " +
        "two while the tape holds two steps and three while it holds three " +
        "(specs/ui.md § Build)",
      `with two steps it drew ${JSON.stringify(atTwo.map((d) => d.text))} ` +
        `and with three ${JSON.stringify(atThree.map((d) => d.text))}`,
    );
  }
});
