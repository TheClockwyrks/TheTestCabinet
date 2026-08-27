// Carom — ui/state-howto: How to Play is reachable from the menu, and it names
// the movement keys.
//
// The menu is navigated with real key events — two moves down to the third
// entry, then confirm — so what opens the screen is the build's own menu
// handling through the actions the case binds, not a state assignment.
//
// The specification fixes no copy for the screen beyond that it "names the
// controls" (specs/ui.md, specs/overview.md), so what is read is that the
// frame's text names the movement keys the case binds: `W` and `S` as keys of
// their own, and the arrow keys by name or glyph. How the screen reads is the
// reviewer's, from the capture.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertMatches } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the how-to-play screen from the menu and names the movement keys", async () => {
  // One advanced frame settles the reset (specs/instrumentation.md), so the
  // first tap's edge reaches the settled title world whole.
  h.debug.reset();
  await h.advance(1);
  await h.tap("ArrowDown"); // SOLO -> VERSUS
  await h.tap("ArrowDown"); // VERSUS -> HOW TO PLAY
  await h.tap("Enter");

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "howto");

  assertEqual(h.snapshot().screen, "howto");

  const copy = drawnText(h.calls).join(" ");
  assertMatches(copy, /\bW\b/i);
  assertMatches(copy, /\bS\b/i);
  assertMatches(copy, /arrow|\bup\b|\bdown\b|\u2191|\u2193/i);
});
