// Refract — campaign/select-move-vertical: up and down move the select
// highlight between rows in the same column, wrapping top to bottom.
//
// specs/modes/campaign.md: "up and down move it between rows in the same
// column, wrapping between the top row and the bottom row." The highlight is
// read back from `selectIndex` (specs/instrumentation.md), and the moves run
// down column 2 — one step off the corner, so staying in the column is
// visibly the rule being exercised rather than a fixed point of it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAction,
  startCampaign,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the highlight down its column and wraps between top and bottom", async () => {
  await startCampaign(h);
  await fireAction(h, "right");
  assertEqual(
    (await h.snapshot()).selectIndex,
    1,
    "the highlight starts the column walk on board 2",
  );

  await fireAction(h, "down");
  assertEqual(
    (await h.snapshot()).selectIndex,
    7,
    "down moves one row down the same column",
  );
  await captureStill(h, "highlight");

  await fireAction(h, "down");
  assertEqual(
    (await h.snapshot()).selectIndex,
    13,
    "down moves to the third row, same column",
  );

  await fireAction(h, "down");
  assertEqual(
    (await h.snapshot()).selectIndex,
    19,
    "down moves to the bottom row, same column",
  );

  await fireAction(h, "down");
  assertEqual(
    (await h.snapshot()).selectIndex,
    1,
    "down wraps from the bottom row to the top row",
  );

  await fireAction(h, "up");
  assertEqual(
    (await h.snapshot()).selectIndex,
    19,
    "up wraps from the top row to the bottom row",
  );
});
