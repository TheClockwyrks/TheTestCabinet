// Refract — campaign/select-enter: confirm on board 1 enters it.
//
// The one transition a campaign cannot exist without: `confirm` — the real
// registered action — on the fresh grid's board 1 goes to `playing` with
// `boardIndex` 0 and every beam empty (specs/modes/campaign.md: confirm on an
// unlocked board enters it and goes to playing; entering a board always starts
// it with every beam empty).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
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

it("enters board 1 on playing with every beam empty", async () => {
  await startCampaign(h);
  assertEqual(h.snapshot().selectIndex, 0, "the fresh grid opens on board 1");

  await tapAction(h, "confirm");
  await h.advance(1);
  captureStill(h, "entered");

  const entered = h.snapshot();
  assertEqual(entered.screen, "playing", "confirm on board 1 goes to playing");
  assertEqual(entered.boardIndex, 0, "board 1 is the board entered");
  assertBeamsEmpty(entered, "the entered board");
});
