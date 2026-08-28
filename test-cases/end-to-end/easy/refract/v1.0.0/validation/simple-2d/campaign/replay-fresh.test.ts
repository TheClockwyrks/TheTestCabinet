// Refract — campaign/replay-fresh: entering a board already solved starts it
// empty, exactly as a first attempt does.
//
// Board 1 is really solved — its beams full at the moment the solved screen
// arrives — then re-entered off the grid. What arrives must be a first
// attempt in every reading the snapshot gives: every beam empty and the board
// not solved, because "Entering a board always starts it with every beam
// empty, whether it is a first attempt or a replay. Progress is per board and
// is never partially banked" (specs/modes/campaign.md).

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

it("re-entering the solved board starts it with every beam empty", async () => {
  await resetTo(h);
  await startCampaign(h);
  await driveCourse(h, 1);
  await tapAction(h, "back");
  assertEqual(
    h.snapshot().screen,
    "select",
    "back on the solved screen returns to the grid",
  );

  // The highlight landed on board 1, the solved board, so one confirm
  // re-enters it.
  await tapAction(h, "confirm");
  captureStill(h, "fresh");

  const reentered = h.snapshot();
  assertEqual(
    reentered.screen,
    "playing",
    "confirm on a solved board enters it again (specs/modes/campaign.md)",
  );
  assertEqual(reentered.boardIndex, 0, "the board re-entered is board 1");
  assertBeamsEmpty(
    reentered,
    "a replay starts with every beam empty, exactly as a first attempt does",
  );
  assertEqual(
    reentered.solved,
    false,
    "with every beam empty the board is not solved (specs/beams.md R9): " +
      "no progress was banked",
  );
});
