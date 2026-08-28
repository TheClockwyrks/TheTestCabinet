// Refract — campaign/select-move-horizontal: left and right move the select
// highlight within its row, wrapping from either end of the row to the other.
//
// Every press is the real registered action's bound key, and every landing is
// read back from `selectIndex` (specs/modes/campaign.md). The top row's
// indices are 0..5, so the four presses cover both directions and both wraps:
// right off 0 to 1, left back to 0, left off the row's start to its end (5),
// right off the end back to its start (0).

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

it("moves within the row and wraps at both ends, read from selectIndex", async () => {
  await startCampaign(h);
  assertEqual(h.snapshot().selectIndex, 0, "the fresh grid opens on board 1");

  await tapAction(h, "right");
  assertEqual(h.snapshot().selectIndex, 1, "right moves one column along");
  captureStill(h, "highlight");

  await tapAction(h, "left");
  assertEqual(h.snapshot().selectIndex, 0, "left moves one column back");

  await tapAction(h, "left");
  assertEqual(
    h.snapshot().selectIndex,
    5,
    "left at the row's start wraps to its end",
  );

  await tapAction(h, "right");
  assertEqual(
    h.snapshot().selectIndex,
    0,
    "right at the row's end wraps to its start",
  );
});
