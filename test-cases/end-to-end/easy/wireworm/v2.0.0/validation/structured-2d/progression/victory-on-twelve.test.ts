// progression/victory-on-twelve — clearing level TOTAL_LEVELS wins the run.
//
// specs/progression.md, Winning and losing: the run is won when the last worm
// segment of level `12` is removed, and the game moves to the `victory` screen.
// That is the one place the twelve-level run ends in anything but a game over,
// and it is the reason `level-advances`'s "up by one" has a last level to stop
// at.
//
// THE REMOVAL IS DRIVEN, NOT POSED, and it is the same removal
// `level-clears-on-last-segment` drives — the clear is the removal itself. What
// separates the two points is the level it happens on: a build that treats the
// twelfth level like any other advances to a thirteenth and is still `playing`
// here, and a build that ends the run one level early never reaches this at all.

import { afterEach, beforeEach, it } from "vitest";
import { TOTAL_LEVELS } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { clearLastSegment } from "./clear";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves to the victory screen when level 12's last segment goes", async () => {
  const cleared = await clearLastSegment(h, TOTAL_LEVELS);

  // One frame past the clear, so the picture kept is the victory screen itself.
  // The reading below is `cleared`, so this decides nothing.
  await h.advance(1);
  captureStill(h, "victory");

  assertEqual(
    cleared.screen,
    "victory",
    `the screen clearing level ${TOTAL_LEVELS} opens`,
  );
});
