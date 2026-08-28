// Refract — campaign/select-move-vertical: up and down move the select
// highlight between rows in the same column, wrapping between top and bottom.
//
// The moves are real registered actions and the highlight is read back from
// selectIndex (specs/instrumentation.md). The grid is six columns by four
// rows, so from board 1 (index 0) one down is the same column a row lower —
// index 6 — one up is back to 0, an up at the top row wraps to the bottom
// row's index 18, and a down there wraps back to the top
// (specs/modes/campaign.md "up and down move it between rows in the same
// column, wrapping between the top row and the bottom row").

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

it("up and down move the highlight down its column and wrap top to bottom", async () => {
  await resetTo(h);
  await startCampaign(h);
  assertEqual(
    h.snapshot().selectIndex,
    0,
    "the highlight arrives on board 1 (specs/modes/campaign.md)",
  );

  await tapAction(h, "down");
  assertEqual(
    h.snapshot().selectIndex,
    6,
    "down moves the highlight one row down the same column",
  );
  captureStill(h, "highlight");

  await tapAction(h, "up");
  assertEqual(
    h.snapshot().selectIndex,
    0,
    "up moves the highlight one row up the same column",
  );

  await tapAction(h, "up");
  assertEqual(
    h.snapshot().selectIndex,
    18,
    "up at the top row wraps the highlight to the bottom row",
  );

  await tapAction(h, "down");
  assertEqual(
    h.snapshot().selectIndex,
    0,
    "down at the bottom row wraps the highlight to the top row",
  );
});
