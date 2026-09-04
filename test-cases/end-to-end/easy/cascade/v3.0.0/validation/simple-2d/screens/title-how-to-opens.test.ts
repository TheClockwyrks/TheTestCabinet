// screens/title-how-to-opens — the title's HOW TO PLAY opens the how-to screen.
//
// THE RULE. specs/screens.md's title table: `HOW TO PLAY` "moves to `howto`".
// specs/controls.md fixes its hit rectangle as `TITLE_HOW_TO`
// (`{ x: 480, y: 516, w: 320, h: 52 }`) and states that a control answers a CLICK
// whose press point lies inside that rectangle.
//
// DRIVEN THROUGH THE ENGINE'S OWN POINTER. {@link tapPointer} dispatches a real
// press and release at the rectangle's center and runs the one frame that delivers
// both, so what is exercised is the player's path.
//
// ONE REQUIREMENT, IN ONE DIRECTION: that the press REACHES the how-to screen. The
// way back is `screens/howto-back-returns` and the copy the screen carries is
// `screens/howto-copy`, so a build that opens the screen and cannot leave it, or
// opens an empty one, fails those points and keeps this one.
//
// The starting screen is posed with `setScreen("title")`, which changes nothing
// else (specs/instrumentation.md), and `clearTable` empties the piles the
// specification lets show behind it: nothing this point reads concerns a card.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_HOW_TO } from "../constants";
import {
  captureStill,
  createHarness,
  tapPointer,
  type Harness,
} from "../harness";

/** A point inside `TITLE_HOW_TO`: its center (specs/controls.md). */
const PRESS = {
  x: TITLE_HOW_TO.x + TITLE_HOW_TO.w / 2,
  y: TITLE_HOW_TO.y + TITLE_HOW_TO.h / 2,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reaches the how-to screen when HOW TO PLAY is clicked", async () => {
  h.debug.setScreen("title");
  h.debug.clearTable();
  assertEqual(
    h.snapshot().screen,
    "title",
    "posing: the game is on the title screen, where TITLE_HOW_TO answers " +
      "(specs/controls.md: a control answers only on the screen it belongs to)",
  );

  await tapPointer(h, PRESS.x, PRESS.y);
  captureStill(h, "howto");

  assertEqual(
    h.snapshot().screen,
    "howto",
    "the screen after a click inside TITLE_HOW_TO (specs/screens.md)",
  );
});
