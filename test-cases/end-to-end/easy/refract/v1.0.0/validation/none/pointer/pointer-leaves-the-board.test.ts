// Refract — pointer/pointer-leaves-the-board: taking the back target leaves the
// board.
//
// specs/modes/campaign.md: `back` during `playing` returns to `select`, and
// specs/controls.md says the `back` target does the same thing. It is the way
// out of a board for a player working the game by pointer alone, so a build
// that draws the control without wiring it strands that player on the board.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressRelease,
  startCampaign,
  targetById,
  targetCenter,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the grid from a press and release on the back control", async () => {
  await h.debug.reset({ seed: 1 });
  await h.advance(1);
  await startCampaign(h);

  const cell = targetCenter(targetById(await h.snapshot(), "board-1"));
  await pressRelease(h, cell);
  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "the first board is entered first",
  );

  const back = targetCenter(targetById(await h.snapshot(), "back"));
  await pressRelease(h, back);

  assertEqual(
    (await h.snapshot()).screen,
    "select",
    "taking the back target returns to the grid, as the back action does " +
      "(specs/modes/campaign.md, Leaving a board)",
  );
  await captureStill(h, "select");
});
