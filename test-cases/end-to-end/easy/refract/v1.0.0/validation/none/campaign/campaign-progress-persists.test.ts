// Refract — campaign/campaign-progress-persists: campaign progress lasts the
// session, across a Cascade detour.
//
// specs/modes/campaign.md: "Campaign progress lasts the session. Returning to
// title and entering the campaign again shows the same grid, with the same
// boards unlocked and solved." The detour really plays: board 1 is solved,
// the game returns to the title, one generated Cascade board is solved with
// the case's spec-derived solver — moving `solvedCount`, the state most
// tempting to share storage with the campaign's — and on re-entering the
// campaign, `unlockedCount` and `solvedBoards` must stand exactly as the
// solve left them.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, fail } from "../assert";
import {
  boardFromSnapshot,
  captureStill,
  createHarness,
  drawBeams,
  driveCourse,
  fireAction,
  startCampaign,
  startCascade,
  type Harness,
} from "../harness";
import { solve } from "../solver";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps unlockedCount and solvedBoards across a Cascade detour", async () => {
  // Solve board 1 and return to the title.
  await driveCourse(h, 1);
  await fireAction(h, "back");
  await fireAction(h, "back");
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the detour starts from the title",
  );

  // Play Cascade for one solved board, then leave it from playing.
  await startCascade(h);
  const board = boardFromSnapshot(await h.snapshot());
  const verdict = solve(board);
  if (verdict.status !== "solved") {
    fail("a solvable first cascade board for the detour", verdict.status);
  }
  await drawBeams(h, verdict.beams);
  const solvedScreen = await h.snapshot();
  assertEqual(
    solvedScreen.screen,
    "solved",
    "the detour's cascade board solves",
  );
  await fireAction(h, "confirm"); // NEXT BOARD, highlighted on arrival
  await fireAction(h, "back"); // back during playing ends the sequence
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the detour ends back on the title",
  );

  // Re-enter the campaign: the same grid.
  await startCampaign(h);
  await captureStill(h, "persisted");
  const grid = await h.snapshot();
  assertEqual(grid.screen, "select", "the campaign reopens on its grid");
  assertEqual(
    grid.unlockedCount,
    2,
    "the unlocks stand unchanged after the detour",
  );
  assertDeepEqual(
    grid.solvedBoards,
    [0],
    "the solves stand unchanged after the detour",
  );
});
