// Refract — campaign/campaign-starts: choosing CAMPAIGN from the title sets
// mode to campaign and goes to select with a fresh course.
//
// The entry is the player's own: `confirm` on the title menu's first item,
// raised through the real registered action (specs/modes/campaign.md). What a
// fresh course means is what the check reads back: unlockedCount 1 — board 1
// open, every other board locked — and no board recorded solved.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCampaign,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets mode to campaign and lands on select with a fresh course", async () => {
  await startCampaign(h);
  captureStill(h, "select");

  const arrived = h.snapshot();
  assertEqual(arrived.mode, "campaign", "choosing CAMPAIGN sets the mode");
  assertEqual(arrived.screen, "select", "choosing CAMPAIGN goes to select");
  assertEqual(
    arrived.unlockedCount,
    1,
    "a fresh course opens with board 1 alone unlocked",
  );
  assertDeepEqual(
    arrived.solvedBoards,
    [],
    "a fresh course records no board solved",
  );
});
