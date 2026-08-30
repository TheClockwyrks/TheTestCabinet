// deal/seven-columns — a deal lays the tableau out in seven columns.
//
// THE RULE. specs/deal.md deals the shuffled deck to `TABLEAU_COLUMNS` (`7`)
// columns, left to right, so the tableau a deal produces is seven columns and not
// six, eight, or ten. `TABLEAU_COLUMNS` is imported from `src/constants.ts`, the
// module the build was seeded with, so what this reads back is the figure the
// build was handed rather than a number written out here.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. The NUMBER of columns, and nothing
// about what is in them: how many cards each column receives is
// `deal/column-sizes`, and which of them are face-up is `deal/lowest-face-up` and
// `deal/rest-face-down`. A build that reports seven columns and deals into five of
// them passes here and fails there, which is what makes a failed grade name the
// requirement that was missed.
//
// THE WORLD IT POSES. `openTable` resets, enters play, and empties all thirteen
// piles, so the only thing on the table when `deal()` runs is what the deal itself
// put there. Nothing else is posed: this item concerns the deal alone.

import { afterEach, beforeEach, it } from "vitest";
import { TABLEAU_COLUMNS } from "../../src/constants";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("deals the tableau as seven columns", async () => {
  openTable(harness);
  harness.debug.deal();

  // One frame, so the picture kept below is the table the deal laid out and the
  // reading below is taken after a real frame of the build's own update ran.
  await harness.advance(1);
  captureStill(harness, "dealt");

  assertLength(
    harness.snapshot().tableau,
    TABLEAU_COLUMNS,
    "columns in the tableau a deal laid out (specs/deal.md)",
  );
});
