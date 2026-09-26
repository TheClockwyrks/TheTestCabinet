// ui/state-howto — HOW TO PLAY is reachable from the menu, and the screen names
// the movement keys.
//
// The title's selection is POSED on `HOW TO PLAY` and the entry is opened with a
// real `Enter` press, so what reaches the screen is the build's own confirm
// handling through the action the case binds. The arrow presses that would
// otherwise walk down to the entry are `navigation/title-down`'s point and
// `navigation/title-down-wraps`'s, and a build whose arrows never moved should
// fail those rather than lose this screen's copy as well.
//
// specs/ui.md fixes no copy for the screen beyond that it names the controls,
// so what is read is that the frame's text names the movement keys: `W` and `S`
// as words of their own, and the arrow keys by name or by glyph. How the screen
// says the rest is the build's.
//
// The text is the LOGICAL runs the frame spelled (`drawnTextLines`) AND the raw
// `fillText` strings (`drawnText`) together. The runs are needed because a build
// that letter-spaces its copy draws one glyph per call, and `U`, `P` joined by a
// space would never read as `UP`. The raw split is kept beside them because the
// patterns are boundary-anchored: `W` is one glyph, so a build that draws it and
// its action as two calls close together (`W`, then `UP` a few units on) can
// coalesce into `WUP` and lose the boundary the raw string still has. The union
// reads both, so neither presentation is fed back as a failure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertMatches } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  drawnText,
  drawnTextLines,
  type Harness,
} from "../harness";

/** The title menu's third entry (specs/ui.md, `TITLE_ITEMS`). */
const HOW_TO_PLAY = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** The movement keys, as a screen names them (specs/modes/*.md). */
const NAMES_W = /\bW\b/;
const NAMES_S = /\bS\b/;
const NAMES_ARROWS = /ARROW|\bUP\b|\bDOWN\b|[↑↓▲▼]/;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the how-to screen from the menu, naming the movement keys", async () => {
  await h.debug.reset();
  await h.debug.setMenuIndex(HOW_TO_PLAY);
  await h.tap("Enter");

  const calls = await h.frameCalls();
  await captureStill(h, "howto");

  assertEqual((await h.snapshot()).screen, "howto");

  const text = [...drawnText(calls), ...drawnTextLines(calls)]
    .join(" ")
    .toUpperCase();
  assertMatches(text, NAMES_W);
  assertMatches(text, NAMES_S);
  assertMatches(text, NAMES_ARROWS);
});
