// Refract — campaign/select-move-right: one right press moves the select
// highlight one board along its row.
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

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCampaign,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("right moves the highlight one board along its row", async () => {
  await startCampaign(h);
  assertEqual(
    h.snapshot().selectIndex,
    0,
    "the fresh grid arrives with the highlight on board 1",
  );

  await tapAction(h, "right");
  captureStill(h, "highlight");
  assertEqual(
    h.snapshot().selectIndex,
    1,
    "right moves the highlight one board along the row",
  );
});
