// Refract — campaign/select-enter: confirm on an unlocked board enters it.
//
// A fresh campaign arrives on the grid with the highlight on board 1, the one
// unlocked board, so one confirm through the real action must enter it:
// screen playing, boardIndex 0, and every beam empty, because entering a
// board always starts it with every beam empty (specs/modes/campaign.md
// "confirm on an unlocked or solved board enters it and goes to playing",
// "Entering a board always starts it with every beam empty").

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
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

it("confirm on board 1 enters it with every beam empty", async () => {
  await resetTo(h);
  await startCampaign(h);
  assertEqual(
    h.snapshot().selectIndex,
    0,
    "the highlight arrives on board 1, the unlocked board",
  );

  await tapAction(h, "confirm");
  captureStill(h, "entered");

  const entered = h.snapshot();
  assertEqual(
    entered.screen,
    "playing",
    "confirm on an unlocked board goes to playing (specs/modes/campaign.md)",
  );
  assertEqual(
    entered.boardIndex,
    0,
    "the board entered is board 1, counted from 0",
  );
  assertBeamsEmpty(entered, "entering a board starts it with every beam empty");
});
