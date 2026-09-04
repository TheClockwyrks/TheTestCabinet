// screens/title-best-readout — the title screen draws the best score.
//
// specs/ui.md's `title` table gives the screen a Best score: `BEST_LABEL`
// (`BEST`), "above the session's best score". Both halves are read — the label
// and the figure — because a screen that shows `BEST` over a blank tells the
// player nothing, and a screen that shows a bare number tells them nothing
// either.
//
// WHAT IS NOT READ IS WHERE THE TWO SIT. The table says the label sits above the
// figure, and a build that draws them as one run (`BEST 810`) has satisfied the
// player's reading of it exactly as well; how the screen is laid out is loose and
// reviewed. So the reading is that both are on the screen.
//
// The best is posed onto a fresh session, so the figure read back cannot be the
// zero a reset leaves behind — a build that draws nothing at all would otherwise
// pass on a screen showing `0`.
//
// Matching is by substring and ignores case, and a figure is looked for among the
// numbers each run of text holds, so `BEST 810` and a padded `0810` are the same
// figure to this point as they are to a player.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BEST_LABEL } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  poseScene,
  type Harness,
} from "../harness";
import { drewNumber } from "./copy";

/** The session's best score, posed onto the title. */
const BEST = 810;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the best label and the session's best score", async () => {
  const title = await poseScene(h, { screen: "title", best: BEST });
  assertEqual(title.screen, "title", "the screen the frame is read from");
  assertEqual(title.best, BEST, "the best score the screen is reporting");

  const calls = await h.frameCalls();
  await captureStill(h, "title");

  assertEqual(
    drewText(calls, BEST_LABEL),
    true,
    `the title drawing ${BEST_LABEL}`,
  );
  assertEqual(drewNumber(calls, BEST), true, "the session's best score");
});
