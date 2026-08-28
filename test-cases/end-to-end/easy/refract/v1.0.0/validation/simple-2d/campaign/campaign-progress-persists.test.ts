// Refract — campaign/campaign-progress-persists: campaign progress lasts the
// session.
//
// The manifest's detour, run for real: solve board 1, return to the title,
// play Cascade (really entered through the title menu, onto its first
// generated board), abandon it back to the title, and enter the campaign
// again. The grid that arrives must carry the same progress — unlockedCount 2
// and solvedBoards holding board 1 — because "Campaign progress lasts the
// session. Returning to title and entering the campaign again shows the same
// grid, with the same boards unlocked and solved" (specs/modes/campaign.md),
// and nothing about the cascade run touches the campaign's fields.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  resetTo,
  startCampaign,
  startCascade,
  tapAction,
  type Harness,
} from "../harness";
import { titleMenuToFirst } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("the grid is unchanged after a Cascade detour", async () => {
  await resetTo(h);
  await startCampaign(h);
  await driveCourse(h, 1);
  await tapAction(h, "back"); // solved -> select
  await tapAction(h, "back"); // select -> title
  assertEqual(
    h.snapshot().screen,
    "title",
    "the grid left for the title before the detour",
  );

  // Play Cascade: the title highlight walked to CAMPAIGN so startCascade's
  // one down lands on CASCADE, then back abandons the generated board.
  await titleMenuToFirst(h);
  await startCascade(h);
  await tapAction(h, "back");
  assertEqual(
    h.snapshot().screen,
    "title",
    "back during the cascade board returns to the title",
  );

  await titleMenuToFirst(h);
  await tapAction(h, "confirm");
  captureStill(h, "persisted");

  const again = h.snapshot();
  assertEqual(
    again.screen,
    "select",
    "entering the campaign again shows the grid",
  );
  assertEqual(
    again.unlockedCount,
    2,
    "unlockedCount is unchanged by the detour (specs/modes/campaign.md: " +
      "campaign progress lasts the session)",
  );
  assertDeepEqual(
    again.solvedBoards,
    [0],
    "solvedBoards is unchanged by the detour (specs/modes/campaign.md: " +
      "the same boards unlocked and solved)",
  );
});
