// Refract — campaign/select-move-up: one up press moves the select highlight
// one row up its column.
//
// specs/modes/campaign.md, the select screen: "`left` and `right` move the
// highlight within its row, wrapping from either end of the row to the other.
// `up` and `down` move it between rows in the same column, wrapping between
// the top row and the bottom row." The highlight is read back from
// `selectIndex`, the board highlighted on select counted from 0
// (specs/instrumentation.md), and the action is fired through the real
// registered action. The grid is `GRID_COLS` by `GRID_ROWS`
// (specs/modes/campaign.md), so a step along a row is a step of 1 and a step
// between rows is a step of `GRID_COLS`.
//
// The highlight arrives on the top row and nothing poses `selectIndex`, so the
// one step down is what puts it where a plain up move can be read. That step is
// `campaign/select-move-down`'s own requirement, asserted here as a
// precondition rather than graded.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCampaign,
  tapAction,
  type Harness,
} from "../harness";
import { GRID_COLS } from "./support";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("up moves the highlight one row up the same column", async () => {
  await startCampaign(h);
  assertEqual(
    h.snapshot().selectIndex,
    0,
    "the fresh grid arrives with the highlight on board 1",
  );

  await tapAction(h, "down");
  assertEqual(
    h.snapshot().selectIndex,
    GRID_COLS,
    "precondition: the highlight stands one row down the column",
  );

  await tapAction(h, "up");
  captureStill(h, "highlight");
  assertEqual(
    h.snapshot().selectIndex,
    0,
    "up moves the highlight one row up the same column",
  );
});
