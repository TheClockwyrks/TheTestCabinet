// ui/state-howto — HOW TO PLAY is reachable from the menu, and the screen names
// the movement keys.
//
// The menu is navigated with real key events (two moves down to the third
// entry, then confirm), so what opens the screen is the build's own menu
// handling through the actions the case binds.
//
// specs/ui.md fixes no copy for the screen beyond that it names the controls,
// so what is read is that the frame's text names the movement keys: `W` and `S`
// as words of their own, and the arrow keys by name or by glyph. How the screen
// says the rest is the build's.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  captureStill,
  createHarness,
  drawnText,
  type Harness,
} from "../harness";

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
  await h.tap("ArrowDown"); // SOLO -> VERSUS
  await h.tap("ArrowDown"); // VERSUS -> HOW TO PLAY
  await h.tap("Enter");

  const calls = await h.frameCalls();
  await captureStill(h, "howto");

  expect((await h.snapshot()).screen).toBe("howto");

  const text = drawnText(calls).join(" ").toUpperCase();
  expect(text).toMatch(NAMES_W);
  expect(text).toMatch(NAMES_S);
  expect(text).toMatch(NAMES_ARROWS);
});
