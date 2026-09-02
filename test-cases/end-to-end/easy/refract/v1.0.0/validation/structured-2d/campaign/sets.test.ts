// Refract — campaign/sets: the select frame draws all four SET_LABELS texts,
// each aligned with its own row band of the grid.
//
// Two readings of one frame. The copy is the case's — every entry of
// SET_LABELS from `src/constants.ts`, in order from the top row down
// (specs/modes/campaign.md) — and the alignment is read geometrically: each
// label's anchor sits nearer its own row's band of number draws than any other
// row's. A set is a grouping only and gates nothing; the one thing a grouping
// observably IS on this screen is its label on its row, which is what is held
// here. Where exactly a label sits beside its row is the build's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SET_LABELS } from "../constants";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
  startCampaign,
  type Harness,
} from "../harness";
import { nearestIndex, readSelectGrid } from "./support";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the four set labels, each on its own row band", async () => {
  await startCampaign(h);
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "select");

  const grid = readSelectGrid(h);
  const spans = drawnTextSpans(h);
  SET_LABELS.forEach((label, set) => {
    const drawn = spans.find((span) => span.text.toUpperCase().includes(label));
    assertEqual(drawn !== undefined, true, `the select frame draws "${label}"`);
    if (drawn === undefined) return;
    assertEqual(
      nearestIndex(grid.rowsY, drawn.y),
      set,
      `"${label}" sits nearest row ${set + 1} of the grid's four row bands`,
    );
  });
});
