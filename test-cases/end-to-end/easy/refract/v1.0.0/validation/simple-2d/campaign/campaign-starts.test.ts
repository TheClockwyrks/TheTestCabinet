// Refract — campaign/campaign-starts: choosing CAMPAIGN on the title starts a
// fresh campaign at the select grid.
//
// The choice is made the way a player makes it: a fresh title highlights its
// first item, CAMPAIGN (specs/ui.md), so one confirm through the real
// registered action takes it. What arrives must be the campaign at rest —
// mode "campaign", screen "select", board 1 alone unlocked and nothing
// recorded solved (specs/modes/campaign.md "Entering the campaign",
// "Progression") — read straight off the snapshot.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
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

it("CAMPAIGN on the title starts a fresh campaign at the select grid", async () => {
  await resetTo(h);
  assertEqual(
    h.snapshot().menuIndex,
    0,
    "a fresh title highlights TITLE_ITEMS[0], CAMPAIGN (specs/ui.md)",
  );

  await tapAction(h, "confirm");
  captureStill(h, "select");

  const arrived = h.snapshot();
  assertEqual(
    arrived.mode,
    "campaign",
    "choosing CAMPAIGN sets state.mode (specs/modes/campaign.md)",
  );
  assertEqual(
    arrived.screen,
    "select",
    "choosing CAMPAIGN goes to select (specs/modes/campaign.md)",
  );
  assertEqual(
    arrived.unlockedCount,
    1,
    "a fresh course: board 1 alone is unlocked (specs/modes/campaign.md)",
  );
  assertDeepEqual(
    arrived.solvedBoards,
    [],
    "a fresh course: no board is recorded solved (specs/modes/campaign.md)",
  );
});
