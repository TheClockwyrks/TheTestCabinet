// Facet — targets/release-takes-target: a release inside the armed target takes
// it.
//
// The third row of specs/controls.md's table of what the pointer does to a
// screen: "Releases within the armed target — The target is taken, and it is
// disarmed." And the table below it says what taking one means: a `menu-<i>`
// target taken is "The same as `confirm` with `state.menuIndex` at `i`."
//
// SO THIS IS THE EDGE A POINTER-ONLY PLAYER REACHES EVERY SCREEN THROUGH, which
// is why the item is capped at `broken`. `targets/press-arms-target` reads the
// press that arms; nothing has been taken until this release, and a build that
// never wired it has a menu that highlights and does nothing.
//
// `menu-0` IS `PLAY`, SO THE TAKE IS READ AS THE SCREEN IT REACHES.
// specs/ui.md's title menu is `PLAY`, `HOW TO PLAY` in that order, so taking the
// first item starts a round: the screen becomes `playing` and a board is in play.
// What a fresh round is made of is `screens/start-round`'s point, and it is not
// re-read here; what is decided is that the release took the target at all,
// which needs only that the screen the title menu's first item leads to is the
// screen the game is on afterwards.
//
// AND THE TARGET IS DISARMED. `armedTarget` back at `null` is the other half of
// the row. A build that took the item and left the arming standing carries it
// onto the screen it just reached — specs/controls.md says "Leaving a screen
// disarms whatever was armed on it, so a press carried across a screen change
// takes nothing", and a build that keeps it armed breaks exactly that promise.
//
// PRESS AND RELEASE AT ONE POINT, the reported target's center, which
// specs/instrumentation.md guarantees is inside the rectangle the game hit-tests:
// "pressing and releasing at a listed target's center takes that target." A
// release anywhere else is `targets/release-outside-takes-nothing`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { GRID_COLS, GRID_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  takeTarget,
  targetById,
  type Harness,
} from "../harness";

/** The target the gesture takes: the first title item, which specs/ui.md makes `PLAY`. */
const WANTED = "menu-0";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the armed target, and disarms it", async () => {
  await h.debug.reset();
  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the screen the gesture is made on");
  assertEqual(opened.armedTarget, null, "the armed target before the press");
  assertEqual(opened.board.cols, 0, "the board in play before the round began");

  const first = targetById(opened, WANTED);
  const taken = await takeTarget(h, first);

  // The frame the round's first board is drawn on, and the picture of it.
  await h.advance(1);
  await captureStill(h, "taken");

  assertEqual(
    taken.screen,
    "playing",
    `the screen taking ${WANTED} reached, which is where PLAY leads`,
  );
  assertEqual(taken.board.cols, GRID_COLS, "the columns of the board dealt");
  assertEqual(taken.board.rows, GRID_ROWS, "the rows of the board dealt");
  assertGreaterThan(
    taken.board.cells.length,
    0,
    "the cells of the board the round began on",
  );
  assertEqual(taken.armedTarget, null, "the armed target the release disarmed");
});
