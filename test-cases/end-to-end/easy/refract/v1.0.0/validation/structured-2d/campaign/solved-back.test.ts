// Refract — campaign/solved-back: the solved screen returns to the grid, both
// ways the specification gives it.
//
// The two exits of one screen (specs/modes/campaign.md): the back-to-select
// choice — third on the solved menu, two `down` presses from the arrival
// highlight — goes to `select`, and the `back` action on the same screen goes
// to `select` as well. The screen is reached twice in one session, the second
// time by a replay solve, so both exits are exercised on the build's own
// solved screen.

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

it("goes to select from the third choice, and from back", async () => {
  // The third choice: down, down, confirm.
  await startCampaign(h);
  await tapAction(h, "confirm"); // enter board 1
  solveCampaignBoard(h, 0);
  await h.advance(1);
  assertEqual(h.snapshot().screen, "solved", "solving board 1 goes to solved");
  await tapAction(h, "down");
  await tapAction(h, "down");
  assertEqual(
    h.snapshot().menuIndex,
    2,
    "two downs highlight the third choice",
  );
  await tapAction(h, "confirm");
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "select",
    "the back-to-select choice goes to select",
  );

  // The back action, from a fresh solved screen reached by a replay.
  await tapAction(h, "confirm"); // re-enter board 1 (the highlight sits on it)
  assertEqual(h.snapshot().screen, "playing", "board 1 re-entered");
  solveCampaignBoard(h, 0);
  await h.advance(1);
  assertEqual(h.snapshot().screen, "solved", "the replay solve goes to solved");
  await tapAction(h, "back");
  await h.advance(1);
  captureStill(h, "select");
  assertEqual(h.snapshot().screen, "select", "back on solved goes to select");
});
