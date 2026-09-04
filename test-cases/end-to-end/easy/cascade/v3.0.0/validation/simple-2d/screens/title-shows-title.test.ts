// screens/title-shows-title — the title screen draws the game's name.
//
// THE RULE. specs/screens.md fixes the title screen's copy by name and by
// literal: the Title element is `TITLE_TEXT`, whose content is `CASCADE`. Every
// piece of screen copy the file names "is the text that is drawn". So a frame of
// the title screen carries that literal among its text.
//
// THE SCREEN IS POSED RATHER THAN OPENED. `setScreen("title")` puts the game on
// the screen this point is about and changes nothing else
// (specs/instrumentation.md), so a build that draws the title screen perfectly and
// opens on the wrong one fails `screens/opens-on-title` alone, and this point
// decides the copy in one direction. `clearTable` empties the thirteen piles
// underneath, because the specification lets the table show behind the screen and
// nothing this point reads concerns a card.
//
// MATCHED BY SUBSTRING, IGNORING CASE ({@link drewText}). The literal is the
// case's; how a build presents it — spaced, padded, drawn inside a larger run — is
// the build's, and requiring the exact run would fail a screen showing precisely
// the right word.
//
// WHAT THIS DOES NOT DECIDE. Where the title is drawn, how big it is, or whether
// it reads against what is behind it, which is `presentation/text-legible`. The
// tagline and the two items are their own points.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_TEXT } from "../constants";
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

it("draws TITLE_TEXT among the title screen's text", async () => {
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
    drewText(calls, TITLE_TEXT),
    true,
    `the title screen's frame drawing TITLE_TEXT (${TITLE_TEXT}) ` +
      "(specs/screens.md)",
  );
});
