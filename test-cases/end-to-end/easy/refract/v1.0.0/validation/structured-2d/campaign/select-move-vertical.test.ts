// Refract — campaign/select-move-vertical: up and down move the select
// highlight between rows in the same column, wrapping between the top row and
// the bottom row.
//
// Every press is the real registered action's bound key, and every landing is
// read back from `selectIndex` (specs/modes/campaign.md). Rows are six wide,
// so a step between rows in column 0 is a step of 6: down off 0 to 6, up back
// to 0, up off the top row to the bottom (18), down off the bottom back to the
// top (0).

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

it("moves between rows in the same column and wraps top to bottom, read from selectIndex", async () => {
  await startCampaign(h);
  assertEqual(h.snapshot().selectIndex, 0, "the fresh grid opens on board 1");

  await tapAction(h, "down");
  assertEqual(h.snapshot().selectIndex, 6, "down moves one row down");
  captureStill(h, "highlight");

  await tapAction(h, "up");
  assertEqual(h.snapshot().selectIndex, 0, "up moves one row up");

  await tapAction(h, "up");
  assertEqual(
    h.snapshot().selectIndex,
    18,
    "up at the top row wraps to the bottom row",
  );

  await tapAction(h, "down");
  assertEqual(
    h.snapshot().selectIndex,
    0,
    "down at the bottom row wraps to the top row",
  );
});
