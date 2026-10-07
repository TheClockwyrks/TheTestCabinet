// Refract — campaign/select-highlight-lands: the highlight lands on the board
// the player most recently entered or solved.
//
// specs/modes/campaign.md: "On arriving at the screen the highlight sits on
// the board the player most recently entered or solved, so a solve is seen
// landing on the grid. Before any board has been entered it sits on board 1."
// The item's three cases, in one session: `selectIndex` 0 on the fresh grid,
// 0 again after solving board 1 and returning, and 1 after entering board 2
// and backing out.
//
// GETTING BACK TO THE GRID. The solve leaves the game on the solved screen,
// and specs/modes/campaign.md gives that screen two exits to `select`: its
// third menu choice, back to select, and the `back` action. This item's
// subject is on the far side of that step, not the step itself, so it must
// not pin one of the two — `gridFromSolved` takes whichever the build honours,
// and which one that is stays campaign/solved-back-choice's and
// campaign/solved-back-action's verdict alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAction,
  solveCampaignBoard,
  startCampaign,
  type Harness,
} from "../harness";
import { gridFromSolved } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands on board 1 fresh, on board 1 after its solve, on board 2 after backing out of it", async () => {
  await startCampaign(h);
  assertEqual(
    (await h.snapshot()).selectIndex,
    0,
    "before any board has been entered the highlight sits on board 1",
  );

  // Solve board 1 and return: board 1 is the board most recently solved.
  await fireAction(h, "confirm");
  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "board 1 opens for the solve",
  );
  await solveCampaignBoard(h, 0);
  await gridFromSolved(h);
  const afterSolve = await h.snapshot();
  assertEqual(
    afterSolve.selectIndex,
    0,
    "after solving board 1 and returning, the highlight lands on it",
  );

  // Enter board 2 and back out: board 2 is the board most recently entered.
  await fireAction(h, "right");
  await fireAction(h, "confirm");
  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "board 2, unlocked by the solve, opens",
  );
  await fireAction(h, "back");
  await captureStill(h, "landing");
  const afterEntry = await h.snapshot();
  assertEqual(
    afterEntry.screen,
    "select",
    "back during playing returns the grid",
  );
  assertEqual(
    afterEntry.selectIndex,
    1,
    "after entering board 2 and backing out, the highlight lands on it",
  );
});
