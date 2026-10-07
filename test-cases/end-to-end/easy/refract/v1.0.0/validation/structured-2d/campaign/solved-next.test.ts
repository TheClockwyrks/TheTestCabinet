// Refract — campaign/solved-next: the solved screen offers the next board
// first.
//
// Board 1 — a board before the last — is solved for real, and the screen that
// lands is read back: `solved`, with menuIndex 0 on the first choice, and
// `confirm` there enters board 2 on `playing` with every beam empty
// (specs/modes/campaign.md: the first choice, next board, enters board n + 1
// and goes to playing; the first choice is highlighted on arriving).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  solveCampaignBoard,
  startCampaign,
  tapAction,
  type Harness,
} from "../harness";
import { assertBeamsEmpty } from "./support";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("arrives on solved with menuIndex 0, and confirm enters the next board", async () => {
  await startCampaign(h);
  await tapAction(h, "confirm"); // enter board 1
  solveCampaignBoard(h, 0);
  await h.advance(1);
  captureStill(h, "solved");

  const solved = h.snapshot();
  assertEqual(solved.screen, "solved", "solving board 1 goes to solved");
  assertEqual(
    solved.menuIndex,
    0,
    "the first choice is highlighted on arriving",
  );

  await tapAction(h, "confirm");
  await h.advance(1);
  const next = h.snapshot();
  assertEqual(next.screen, "playing", "the first choice enters a board");
  assertEqual(next.boardIndex, 1, "the board entered is board 2, n plus 1");
  assertBeamsEmpty(next, "the next board");
});
