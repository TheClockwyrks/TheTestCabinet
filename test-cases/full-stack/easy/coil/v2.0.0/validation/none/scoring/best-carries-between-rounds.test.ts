// scoring/best-carries-between-rounds — the best survives the round that earned
// it, and the score does not.
//
// specs/scoring.md: "`BEST` is the highest score reached in the current session
// ... it carries from one round to the next so a player who plays again keeps
// it", while "A round starts at a score of `0`." Both halves are one reading of
// the round that opens after the one that earned the best, which is why they are
// decided together: a build that cleared the best along with the score, and a
// build that carried the score along with the best, each fail exactly here.
//
// The best is EARNED rather than posted: the round's score is posed above the
// best of `0` a session opens on, and specs/scoring.md then has the best rise to
// it on the next update, so the figure the fresh round is asked for is one the
// build's own rule put there. The round is ended by running the head into the
// wall, so the crossing between rounds is the build's own too.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY } from "../constants";
import {
  WALL_CELL,
  arrangeApproach,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

/** The score the first round reaches, which becomes the session's best. */
const EARNED = 480;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the best into the next round while the score returns to zero", async () => {
  // A round carrying a score above the best a session opens on, one tick from
  // the wall.
  await arrangeApproach(h, WALL_CELL, { dir: "left", score: EARNED });
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).best,
    EARNED,
    "the best the live score raised",
  );

  const ended = await h.tick();
  assertEqual(ended.screen, "gameover", "the screen the collision ended on");

  // PLAY AGAIN is the first item of OVER_ITEMS, and a screen is arrived at on
  // its first item (specs/ui.md).
  await h.tap(KEY.confirm);
  await captureStill(h, "carried");

  const again = await h.snapshot();
  assertEqual(again.screen, "playing", "the screen PLAY AGAIN opened");
  assertEqual(again.best, EARNED, "the best the fresh round carries");
  assertEqual(again.score, 0, "the score the fresh round opens at");
});
