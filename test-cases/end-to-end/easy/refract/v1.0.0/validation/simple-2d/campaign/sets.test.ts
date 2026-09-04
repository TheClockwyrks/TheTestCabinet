// Refract — campaign/sets: the select frame labels its four row bands with the
// four SET_LABELS entries, in order from the top.
//
// One rendered select frame is read twice: the board numbers give the grid's
// four row bands (specs/modes/campaign.md: six columns wide and four rows
// tall, one row per set), and the frame's other text draws must include every
// entry of SET_LABELS — SET A, SET B, SET C, SET D — each sitting nearer its
// own row band than any other. "Aligned with its own row band" is read as
// nearest-band because the label's exact offset (above the row, beside it) is
// the build's to design; which row a label belongs to is not.
//
// A set is a grouping only and gates nothing: the gate-free half is carried by
// the unlock rule itself (campaign/unlocking.test.ts asserts solving board n
// unlocks n + 1, with no set boundary in the rule), so this suite holds only
// the labelling.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { SET_LABELS } from "../constants";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
  resetTo,
  startCampaign,
  type Harness,
} from "../harness";
import { readSelectGrid, requireSixByFour } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws all four set labels, each on its own row band", async () => {
  await resetTo(h);
  await startCampaign(h);

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "select");

  const grid = readSelectGrid(h);
  requireSixByFour(grid);
  const spans = drawnTextSpans(h);

  SET_LABELS.forEach((label, set) => {
    const drawn = spans.filter((span) =>
      span.text.toUpperCase().includes(label),
    );
    if (drawn.length === 0) {
      fail(
        `the select frame drawing ${JSON.stringify(label)} ` +
          "(SET_LABELS, specs/modes/campaign.md: each row is labelled with " +
          "its set's entry, in order from the top row down)",
        spans.map((span) => span.text),
      );
    }
    for (const span of drawn) {
      let nearest = 0;
      for (let row = 1; row < grid.rowY.length; row += 1) {
        if (
          Math.abs(span.y - grid.rowY[row]) <
          Math.abs(span.y - grid.rowY[nearest])
        ) {
          nearest = row;
        }
      }
      assertEqual(
        nearest,
        set,
        `${label} sits nearest row band ${set + 1} of the grid ` +
          "(specs/modes/campaign.md: one row per set, Set A at the top)",
      );
    }
  });
});
