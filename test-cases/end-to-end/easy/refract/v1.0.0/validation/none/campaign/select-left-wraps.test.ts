// Refract — campaign/select-left-wraps: left at the start of a row wraps the
// select highlight to that row's end.
//
// specs/modes/campaign.md, the select screen: "`left` and `right` move the
// highlight within its row, wrapping from either end of the row to the other.
// `up` and `down` move it between rows in the same column, wrapping between
// the top row and the bottom row." The highlight is read back from
// `selectIndex`, the board highlighted on select counted from 0
// (specs/instrumentation.md), and the action is fired through the keyboard the
// way a player fires it. The grid is `GRID_COLS` by `GRID_ROWS`
// (specs/modes/campaign.md), so a step along a row is a step of 1 and a step
// between rows is a step of `GRID_COLS`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAction,
  startCampaign,
  type Harness,
} from "../harness";
import { GRID_COLS } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("left at the row's start wraps the highlight to the row's end", async () => {
  await startCampaign(h);
  assertEqual(
    (await h.snapshot()).selectIndex,
    0,
    "the fresh grid arrives with the highlight on board 1",
  );

  await fireAction(h, "left");
  await captureStill(h, "highlight");
  assertEqual(
    (await h.snapshot()).selectIndex,
    GRID_COLS - 1,
    "left at the row's start wraps to the last board of that row",
  );
});
