// Refract — campaign/select-right-wraps: right at the end of a row wraps the
// select highlight to that row's start.
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
//
// Nothing poses `selectIndex`, so the row's end is walked to with plain right
// moves rather than reached through the left wrap: a build that wraps one way
// and not the other must fail one point and pass the other. Those steps are
// `campaign/select-move-right`'s requirement, asserted here as a precondition.

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

it("right at the row's end wraps the highlight to the row's start", async () => {
  await startCampaign(h);
  assertEqual(
    (await h.snapshot()).selectIndex,
    0,
    "the fresh grid arrives with the highlight on board 1",
  );

  for (let step = 1; step < GRID_COLS; step += 1) {
    await fireAction(h, "right");
  }
  assertEqual(
    (await h.snapshot()).selectIndex,
    GRID_COLS - 1,
    "precondition: the highlight stands on the last board of the row",
  );

  await fireAction(h, "right");
  await captureStill(h, "highlight");
  assertEqual(
    (await h.snapshot()).selectIndex,
    0,
    "right at the row's end wraps to the first board of that row",
  );
});
