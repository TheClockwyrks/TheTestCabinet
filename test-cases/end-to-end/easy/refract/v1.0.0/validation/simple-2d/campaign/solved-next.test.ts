// Refract — campaign/solved-next: the solved screen offers the next board
// first.
//
// Board 1 — a board before the last — is really solved, so the game moves to
// solved with the first choice highlighted on arrival (menuIndex 0, "The
// first choice is highlighted on arriving at the screen"). The confirm that
// takes it must enter board n + 1: playing, boardIndex 1, every beam empty,
// because the first choice on a board before board 24 is next board and
// entering a board always starts it empty (specs/modes/campaign.md "The
// solved screen").

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  resetTo,
  startCampaign,
  tapAction,
  type Harness,
} from "../harness";
import { assertBeamsEmpty } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("solving a board before the last offers next board as the first choice", async () => {
  await resetTo(h);
  await startCampaign(h);

  const solved = await driveCourse(h, 1);
  assertEqual(
    solved.screen,
    "solved",
    "solving a board before the last goes to solved (specs/modes/campaign.md)",
  );
  assertEqual(
    solved.menuIndex,
    0,
    "the first choice is highlighted on arriving at the screen " +
      "(specs/modes/campaign.md)",
  );
  captureStill(h, "solved");

  await tapAction(h, "confirm");
  const next = h.snapshot();
  assertEqual(
    next.screen,
    "playing",
    "confirm takes the first choice, next board, and goes to playing " +
      "(specs/modes/campaign.md)",
  );
  assertEqual(
    next.boardIndex,
    1,
    "the board entered is board n + 1 (specs/modes/campaign.md)",
  );
  assertBeamsEmpty(next, "the next board starts with every beam empty");
});
