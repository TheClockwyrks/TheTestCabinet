// Refract — campaign/select-highlight-lands: on arriving at the select screen
// the highlight sits on the board most recently entered or solved.
//
// The item's three stated cases, in one session so each arrival is the real
// one (specs/modes/campaign.md: on arriving at the screen the highlight sits
// on the board the player most recently entered or solved; before any board
// has been entered it sits on board 1):
//
//   1. a fresh course arrives on selectIndex 0;
//   2. solving board 1 and returning arrives on selectIndex 0 — the solve is
//      seen landing on the grid;
//   3. entering board 2 and backing out arrives on selectIndex 1.

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lands on the board most recently entered or solved", async () => {
  // Before any board has been entered: board 1.
  await startCampaign(h);
  assertEqual(
    h.snapshot().selectIndex,
    0,
    "a fresh course's highlight sits on board 1",
  );

  // After solving board 1 and returning: still board 1, the board just solved.
  await tapAction(h, "confirm"); // enter board 1
  solveCampaignBoard(h, 0);
  await h.advance(1);
  await tapAction(h, "back"); // back on solved goes to select
  assertEqual(
    h.snapshot().screen,
    "select",
    "back on solved returns to select",
  );
  assertEqual(
    h.snapshot().selectIndex,
    0,
    "after solving board 1 the highlight sits on board 1",
  );

  // After entering board 2 and backing out: board 2, the board last entered.
  await tapAction(h, "right");
  assertEqual(h.snapshot().selectIndex, 1, "the highlight sits on board 2");
  await tapAction(h, "confirm"); // board 2 is unlocked by the solve
  assertEqual(h.snapshot().screen, "playing", "board 2 entered");
  assertEqual(h.snapshot().boardIndex, 1, "board 2 is the board entered");
  await tapAction(h, "back"); // back during playing returns to select
  await h.advance(1);
  captureStill(h, "landing");
  assertEqual(
    h.snapshot().screen,
    "select",
    "back on playing returns to select",
  );
  assertEqual(
    h.snapshot().selectIndex,
    1,
    "after entering board 2 and backing out the highlight sits on board 2",
  );
});
