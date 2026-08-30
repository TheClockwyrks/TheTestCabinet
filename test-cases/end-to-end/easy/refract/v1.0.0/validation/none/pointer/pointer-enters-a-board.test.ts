// Refract — pointer/pointer-enters-a-board: a press and release on a select grid
// cell enters that board.
//
// specs/controls.md: taking a `board-<n>` target does what `confirm` on select
// with the highlight at `n - 1` does. Board 1 is the one board unlocked from a
// fresh course (specs/modes/campaign.md), so it is the cell whose entry is
// unambiguous.

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

it("enters the first board from a press and release on its grid cell", async () => {
  await h.debug.reset({ seed: 1 });
  await h.advance(1);
  await startCampaign(h);
  assertEqual((await h.snapshot()).screen, "select", "the campaign opens on the grid");

  const cell = targetCenter(targetById(await h.snapshot(), "board-1"));
  await pressRelease(h, cell);

  const entered = await h.snapshot();
  assertEqual(
    entered.screen,
    "playing",
    "taking board-1 enters it, as confirm on the first board does " +
      "(specs/controls.md, Operating a screen with the pointer)",
  );
  assertEqual(entered.boardIndex, 0, "and the board entered is the first one");
  await captureStill(h, "playing");
});
