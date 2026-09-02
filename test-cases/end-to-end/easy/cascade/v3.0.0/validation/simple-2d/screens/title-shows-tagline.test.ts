// screens/title-shows-tagline — the title screen draws its tagline.
//
// THE RULE. specs/screens.md fixes the title screen's copy by name and by
// literal: the Tagline element is `TAGLINE_TEXT`, whose content is
// `KLONDIKE SOLITAIRE`. Every piece of screen copy the file names "is the text
// that is drawn". So a frame of the title screen carries that literal among its
// text.
//
// THE SCREEN IS POSED RATHER THAN OPENED. `setScreen("title")` puts the game on
// the screen this point is about and changes nothing else
// (specs/instrumentation.md), so this point is decided on the copy alone and a
// build that opens elsewhere fails `screens/opens-on-title` instead.
// `clearTable` empties the thirteen piles underneath, because the specification
// lets the table show behind the screen and nothing this point reads concerns a
// card.
//
// MATCHED BY SUBSTRING, IGNORING CASE ({@link drewText}). The literal is the
// case's; how a build presents it is the build's.
//
// ONE LITERAL, IN ONE DIRECTION. A build that draws the title and forgets the
// tagline fails here and passes `screens/title-shows-title`, which is why the two
// are separate points.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TAGLINE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  drawFrame,
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

it("draws TAGLINE_TEXT among the title screen's text", async () => {
  h.debug.setScreen("title");
  h.debug.clearTable();
  assertEqual(
    h.snapshot().screen,
    "title",
    "posing: the game is on the title screen the frame below draws " +
      "(specs/instrumentation.md)",
  );

  const calls = await drawFrame(h);
  captureStill(h, "title");

  assertEqual(
    drewText(calls, TAGLINE_TEXT),
    true,
    `the title screen's frame drawing TAGLINE_TEXT (${TAGLINE_TEXT}) ` +
      "(specs/screens.md)",
  );
});
