// Refract — campaign/select-down-wraps: down on the bottom row wraps the select
// highlight to the top row of the same column.
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
// Nothing poses `selectIndex`, so the bottom row is walked down to rather than
// reached through the up wrap: a build that wraps one way and not the other
// must fail one point and pass the other. Those steps are
// `campaign/select-move-down`'s requirement, asserted here as a precondition.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCampaign,
  tapAction,
  type Harness,
} from "../harness";
import { GRID_COLS, GRID_ROWS } from "./support";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("down on the bottom row wraps the highlight to the top row", async () => {
  await startCampaign(h);
  assertEqual(
    h.snapshot().selectIndex,
    0,
    "the fresh grid arrives with the highlight on board 1",
  );

  for (let step = 1; step < GRID_ROWS; step += 1) {
    await tapAction(h, "down");
  }
  assertEqual(
    h.snapshot().selectIndex,
    GRID_COLS * (GRID_ROWS - 1),
    "precondition: the highlight stands on the bottom row",
  );

  await tapAction(h, "down");
  captureStill(h, "highlight");
  assertEqual(
    h.snapshot().selectIndex,
    0,
    "down on the bottom row wraps to the top row of the same column",
  );
});
