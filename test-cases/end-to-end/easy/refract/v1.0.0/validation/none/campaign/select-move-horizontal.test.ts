// Refract — campaign/select-move-horizontal: left and right move the select
// highlight within its row, wrapping at both ends.
//
// specs/modes/campaign.md: "left and right move the highlight within its row,
// wrapping from either end of the row to the other." The highlight is read
// back from `selectIndex`, the board highlighted on select counted from 0
// (specs/instrumentation.md), and the actions are fired through the keyboard
// the way a player fires them.

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

it("moves the highlight along its row and wraps from either end", async () => {
  await startCampaign(h);
  assertEqual(
    (await h.snapshot()).selectIndex,
    0,
    "the fresh grid arrives with the highlight on board 1",
  );

  await fireAction(h, "right");
  assertEqual(
    (await h.snapshot()).selectIndex,
    1,
    "right moves the highlight one board along the row",
  );
  await captureStill(h, "highlight");

  await fireAction(h, "left");
  assertEqual(
    (await h.snapshot()).selectIndex,
    0,
    "left moves the highlight back",
  );

  await fireAction(h, "left");
  assertEqual(
    (await h.snapshot()).selectIndex,
    5,
    "left wraps from the row's start to its end",
  );

  await fireAction(h, "right");
  assertEqual(
    (await h.snapshot()).selectIndex,
    0,
    "right wraps from the row's end to its start",
  );
});
