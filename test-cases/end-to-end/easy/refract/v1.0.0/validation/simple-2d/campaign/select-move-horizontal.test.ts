// Refract — campaign/select-move-horizontal: left and right move the select
// highlight within its row, wrapping from either end to the other.
//
// The moves are real registered actions and the highlight is read back from
// selectIndex, the snapshot's index of the highlighted board
// (specs/instrumentation.md). The grid is six columns wide, so on the top row
// the indices run 0..5: one right from 0 is 1, one left is back to 0, a left
// at the row's start wraps to 5, and a right at its end wraps to 0
// (specs/modes/campaign.md "left and right move the highlight within its row,
// wrapping from either end of the row to the other").

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
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

it("left and right move the highlight along its row and wrap at both ends", async () => {
  await resetTo(h);
  await startCampaign(h);
  assertEqual(
    h.snapshot().selectIndex,
    0,
    "the highlight arrives on board 1 (specs/modes/campaign.md)",
  );

  await tapAction(h, "right");
  assertEqual(
    h.snapshot().selectIndex,
    1,
    "right moves the highlight one board along its row",
  );
  captureStill(h, "highlight");

  await tapAction(h, "left");
  assertEqual(
    h.snapshot().selectIndex,
    0,
    "left moves the highlight back along its row",
  );

  await tapAction(h, "left");
  assertEqual(
    h.snapshot().selectIndex,
    5,
    "left at the row's start wraps the highlight to the row's end",
  );

  await tapAction(h, "right");
  assertEqual(
    h.snapshot().selectIndex,
    0,
    "right at the row's end wraps the highlight to the row's start",
  );
});
