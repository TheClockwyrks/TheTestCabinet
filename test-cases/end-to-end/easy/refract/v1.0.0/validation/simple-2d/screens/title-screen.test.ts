// Refract — screens/title-screen: the game opens on the title, and the frame
// draws the copy the specification fixes for it.
//
// Two readings of the same opening frame. The game's own state says which
// screen it believes it is on and where the highlight rests, and the frame's
// draw calls say what it actually put on the canvas — so a build that reports
// a title it never draws, or draws one it does not report, fails here rather
// than passing on either half alone.
//
// No reset is posed: what is read is the state the build's `initialize` handed
// the engine, which is where the game "opens" (specs/ui.md: the title is where
// the game opens, and `menuIndex` is 0 on arriving at it). The copy is the
// case's own — TITLE_TEXT, TAGLINE_TEXT, and every entry of TITLE_ITEMS from
// `src/constants.ts` — matched by substring, because a menu entry is commonly
// drawn with a selection marker or padding beside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
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

it("opens on the title with menuIndex 0 and draws the fixed copy", async () => {
  // The one frame is what puts the opening screen on the canvas; nothing has
  // been posed, so what it draws is the state the game opened with.
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "title");

  const snapshot = h.snapshot();
  assertEqual(
    snapshot.screen,
    "title",
    "the game opens on the title (specs/ui.md)",
  );
  assertEqual(
    snapshot.menuIndex,
    0,
    "menuIndex is 0 on arriving at the title (specs/ui.md)",
  );

  assertTrue(
    drewText(h.calls, TITLE_TEXT),
    `the frame draws TITLE_TEXT (${TITLE_TEXT}) (specs/ui.md)`,
  );
  assertTrue(
    drewText(h.calls, TAGLINE_TEXT),
    `the frame draws TAGLINE_TEXT (${TAGLINE_TEXT}) (specs/ui.md)`,
  );
  for (const item of TITLE_ITEMS) {
    assertTrue(
      drewText(h.calls, item),
      `the frame draws the ${item} entry of TITLE_ITEMS (specs/ui.md)`,
    );
  }
});
