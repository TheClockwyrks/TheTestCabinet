// Refract — campaign/solved-replay: the replay choice enters the same board
// again.
//
// Board 1 is solved for real, and the solved screen's second choice — one
// `down` from the arrival highlight, then `confirm` — must re-enter the very
// board just solved: the same boardIndex, screen `playing`, every beam empty
// (specs/modes/campaign.md: replay enters the same board again, with every
// beam empty, and goes to playing).

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

it("re-enters the same board on playing with every beam empty", async () => {
  await startCampaign(h);
  await tapAction(h, "confirm"); // enter board 1
  solveCampaignBoard(h, 0);
  await h.advance(1);
  assertEqual(h.snapshot().screen, "solved", "solving board 1 goes to solved");

  await tapAction(h, "down"); // the second choice: replay
  assertEqual(h.snapshot().menuIndex, 1, "down highlights the replay choice");
  await tapAction(h, "confirm");
  await h.advance(1);
  captureStill(h, "replayed");

  const replayed = h.snapshot();
  assertEqual(replayed.screen, "playing", "replay goes to playing");
  assertEqual(replayed.boardIndex, 0, "replay enters the same board, board 1");
  assertBeamsEmpty(replayed, "the replayed board");
});
