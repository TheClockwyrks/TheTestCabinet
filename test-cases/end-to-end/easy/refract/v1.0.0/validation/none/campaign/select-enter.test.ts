// Refract — campaign/select-enter: confirm on an unlocked board enters it.
//
// specs/modes/campaign.md: "confirm on an unlocked or solved board enters it
// and goes to playing", and "Entering a board always starts it with every
// beam empty." On the fresh grid the highlight sits on board 1, the one board
// unlocked from the start, so a single confirm is the whole pose: the game
// must land on playing with `boardIndex` 0 and every beam empty.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAction,
  startCampaign,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("enters board 1 on playing with every beam empty", async () => {
  await startCampaign(h);
  assertEqual(
    (await h.snapshot()).selectIndex,
    0,
    "the fresh grid arrives with the highlight on board 1",
  );

  await fireAction(h, "confirm");
  await captureStill(h, "entered");

  const entered = await h.snapshot();
  assertEqual(entered.screen, "playing", "confirm enters the board");
  assertEqual(entered.boardIndex, 0, "the board entered is board 1");
  for (const [channel, beam] of Object.entries(entered.beams)) {
    assertDeepEqual(beam.cells, [], `${channel}'s beam starts empty`);
  }
});
