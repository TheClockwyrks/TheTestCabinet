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
// The copy is matched the way the package's `drewText` matches it — ignoring
// case, with the whitespace folded out of both sides — because letter spacing
// is a font choice and a build that draws its label a glyph at a time spells it
// with the spacing it chose. The order reading below applies the same fold to
// each placed run it takes a label from.
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
import { SET_LABELS } from "../constants";
import { fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextRuns,
  resetTo,
  startCampaign,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/text";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Copy as `drewText` reads it: upper case, its whitespace folded out. */
function fold(text: string): string {
  return text.replace(/\s+/g, "").toUpperCase();
}

it("draws all four set labels, in order down the frame", async () => {
  await resetTo(h);
  await startCampaign(h);

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "select");

  const runs = drawnTextRuns(h);

  // All four entries are drawn…
  for (const label of SET_LABELS) {
    if (!drewText(h.calls, label)) {
      fail(
        `the select frame drawing ${JSON.stringify(label)} ` +
          "(SET_LABELS, specs/modes/campaign.md: each row is labelled with " +
          "its set's entry, in that order from the top row down)",
        runs.map((run) => run.text),
      );
    }
  }

  // …and they read down the frame in order: each label taken at the topmost
  // of its draws that still sits below the one taken for the label before it.
  let above: number | null = null;
  let previous: string | null = null;
  for (const label of SET_LABELS) {
    const wanted = fold(label);
    const top = runs
      .filter((run) => fold(run.text).includes(wanted))
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
