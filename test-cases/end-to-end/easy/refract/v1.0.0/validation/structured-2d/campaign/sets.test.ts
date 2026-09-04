// Refract — campaign/sets: the select frame names all four sets, in order down
// the frame.
//
// specs/modes/campaign.md: "Each row is labelled with its set's entry in
// SET_LABELS (SET A, SET B, SET C, SET D), in that order from the top row
// down." Two things are fixed there and both are held here: that all four
// entries are drawn, and that they run top to bottom in that order. WHICH ROW
// of tiles a label sits beside, and how far from it, is presentation the
// reviewer judges through the scoring domains — a build may set its labels
// above their rows, beside them, or in a rail down the edge, and every one of
// those honours the sentence.
//
// NOTHING IS BORROWED FROM THE GRID. Reading the board numbers here to find
// row bands passed this item's verdict through surface campaign/select-grid
// owns: a build that marks a locked tile instead of numbering it, or that
// letter-spaces its heading, failed here for a fault that has nothing to do
// with its set labels. The labels place themselves.
//
// THE COPY IS THE VALIDATOR'S OWN. SET_LABELS is read from this project's
// `constants.ts`, which transcribes the four entries from
// specs/modes/campaign.md, and never from the build's `src/constants.ts`. A
// check that matches a build's labels against the build's own list grades
// nothing: it asks whether the build draws what the build says it draws, which
// holds for every build, including one whose labels are wrong. The
// specification is the only authority this compares against.
//
// The copy is matched case-insensitively with runs of whitespace squashed on
// both sides, because letter spacing is a font choice and a build that draws
// its label a glyph at a time spells it with the spacing it chose.
//
// THE ORDER IS READ AS A CHAIN, NOT AS FOUR FIRST DRAWS. Text runs arrive in
// the order the build drew them, and draw order is not top-to-bottom order:
// taking each label's first-drawn run would grade the order a renderer happens
// to emit its text in rather than the frame the player reads. A label may also
// honestly appear more than once — its heading beside its own row, and a
// legend naming all four together. So what is asserted is that the four CAN be
// read down the frame in order: each label in turn is taken at the topmost of
// its draws that still sits below the one taken for the label before it. A
// build whose SET D sits above its SET A has no such reading anywhere on the
// screen and fails; a build that prints a legend is not failed for the one
// line its four labels share.
//
// A set is a grouping only and gates nothing. That half is carried by the
// unlock rule itself — campaign/unlocking asserts that solving board n unlocks
// board n + 1, with no set boundary anywhere in the rule — so this suite holds
// only the labelling.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import { SET_LABELS } from "../constants";
import {
  captureStill,
  createHarness,
  drawnTextLines,
  drawnTextRuns,
  startCampaign,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** One line of copy as it reads: upper case, its runs of whitespace squashed. */
function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim().toUpperCase();
}

it("draws all four set labels, in order down the frame", async () => {
  await startCampaign(h);

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "select");

  const lines = drawnTextLines(h.calls);
  const runs = drawnTextRuns(h);

  // All four entries are drawn…
  for (const label of SET_LABELS) {
    const wanted = squash(label);
    if (!lines.some((line) => squash(line).includes(wanted))) {
      fail(
        `the select frame drawing ${JSON.stringify(label)} ` +
          "(SET_LABELS, specs/modes/campaign.md: each row is labelled with " +
          "its set's entry, in that order from the top row down)",
        lines,
      );
    }
  }

  // …and they read down the frame in order: each label taken at the topmost
  // of its draws that still sits below the one taken for the label before it.
  let above: number | null = null;
  let previous: string | null = null;
  for (const label of SET_LABELS) {
    const wanted = squash(label);
    const top = runs
      .filter((run) => squash(run.text).includes(wanted))
      .map((run) => run.y)
      .filter((y) => above === null || y > above)
      .reduce<number | null>(
        (lowest, y) => (lowest === null || y < lowest ? y : lowest),
        null,
      );
    if (top === null) {
      fail(
        previous === null
          ? `a placed draw of ${JSON.stringify(label)}, to read down the frame`
          : `a draw of ${JSON.stringify(label)} below the draw of ` +
              `${JSON.stringify(previous)} it follows ` +
              "(specs/modes/campaign.md: in that order from the top row down)",
        runs.map((run) => `${run.text} @ y ${run.y}`),
      );
    }
    above = top;
    previous = label;
  }
});
