// screens/cleared-copy — the cleared screen draws its own heading over the same
// panel.
//
// specs/ui.md makes `gameover` and `cleared` "the same screen under two
// headings": `CLEARED_TEXT` (`BOARD CLEARED`) in place of `GAMEOVER_TEXT` (`GAME
// OVER`), with `SCORE_LABEL`, `BEST_LABEL` and `OVER_ITEMS` beneath it unchanged.
// So both directions are read — the heading that must be there, and the heading
// that must not — because a build that reached the ending and then announced a
// death has told the player they lost a round they won.
//
// The ending is driven rather than posed: the chain is laid along every interior
// cell but one, the pellet put on that one, and a single tick eats it, so step 5
// finds nowhere to put the next pellet and the build's own rule ends the round.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { drewText } from "../case-harness/text";
import {
  BEST_LABEL,
  CLEARED_TEXT,
  GAMEOVER_TEXT,
  OVER_ITEMS,
  SCORE_LABEL,
} from "../constants";
import {
  arrangeFullBoard,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws BOARD CLEARED rather than GAME OVER, over the same panel", async () => {
  await arrangeFullBoard(h);
  const ended = await h.tick();
  assertEqual(ended.screen, "cleared", "the screen the frame is read from");

  const calls = await h.frameCalls();
  await captureStill(h, "cleared");

  assertEqual(
    drewText(calls, CLEARED_TEXT),
    true,
    `the screen drawing ${CLEARED_TEXT}`,
  );
  assertEqual(
    drewText(calls, GAMEOVER_TEXT),
    false,
    `the screen drawing no ${GAMEOVER_TEXT}`,
  );
  assertEqual(
    drewText(calls, SCORE_LABEL),
    true,
    `the screen drawing ${SCORE_LABEL}`,
  );
  assertEqual(
    drewText(calls, BEST_LABEL),
    true,
    `the screen drawing ${BEST_LABEL}`,
  );
  for (const item of OVER_ITEMS) {
    assertEqual(drewText(calls, item), true, `the menu drawing ${item}`);
  }
});
