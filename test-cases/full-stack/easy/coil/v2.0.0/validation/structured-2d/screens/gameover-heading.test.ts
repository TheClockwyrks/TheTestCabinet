// screens/gameover-heading — the game-over screen draws its heading.
//
// specs/ui.md tables `gameover` with four elements, and the Heading is one of
// them: `GAMEOVER_TEXT` (`GAME OVER`). Each of the four is its own point, so a
// build that draws the heading and omits the score readout grades differently
// from one that draws nothing on the screen.
//
// The round is ended by running the head into the wall, so the screen read is one
// the build's own step 3 opened rather than one this point posed.
//
// Matching is by substring and ignores case, because how a build sets its copy is
// its own: a heading is commonly drawn with padding around it and a menu entry
// with a selection marker beside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GAMEOVER_TEXT } from "../constants";
import {
  WALL_CELL,
  arrangeApproach,
  captureStill,
  createHarness,
  drewText,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws GAME OVER on the screen a fatal collision reached", async () => {
  arrangeApproach(h, WALL_CELL, { dir: "left" });
  const ended = await h.tick();
  assertEqual(ended.screen, "gameover", "the screen the frame is read from");

  const calls = await h.frameCalls();
  captureStill(h, "gameover");

  assertEqual(
    drewText(calls, GAMEOVER_TEXT),
    true,
    `the screen drawing ${GAMEOVER_TEXT}`,
  );
});
