// Refract — screens/pointer-ignores-menus: a press and release on the title
// menu's drawn items changes nothing.
//
// specs/ui.md: menus are keyboard only, through the registered actions — "the
// pointer draws beams and does not operate menus". So the strongest press
// there is, one dead on each drawn menu item, must leave the screen and the
// highlight exactly as they were.
//
// Where the items are drawn is the build's own layout, so the suite does not
// guess: it reads each item's LOGICAL RUN out of the frame's recorded text
// draws, mapped to logical stage units through the transform and alignment the
// context held at the call, and presses at the middle of that run. A run rather
// than a raw draw, because canvas exposes no portable letter-spacing and a
// build that tracks its menu copy draws a glyph per call, which would leave
// this check a one-glyph box to press instead of the item. specs/ui.md fixes
// the copy of a menu item; how it is spaced is the build's. The pointer
// operations take effect the moment they are called (specs/instrumentation.md),
// and a settling frame is run after them anyway so a build that mishandled the
// press on a later frame is caught too.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../../src/constants";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextRuns,
  resetTo,
  type Harness,
  type TextSpan,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The drawn run carrying `item`, ignoring case, as a menu entry is commonly
 * drawn with a selection marker or padding around the copy itself. */
function spanOf(spans: readonly TextSpan[], item: string): TextSpan | null {
  const wanted = item.trim().toLowerCase();
  return spans.find((span) => span.text.toLowerCase().includes(wanted)) ?? null;
}

it("leaves the title unchanged by presses on its drawn menu items", async () => {
  await resetTo(h);
  const before = h.snapshot();
  assertEqual(before.screen, "title");
  assertEqual(before.menuIndex, 0);

  // One clean frame's draws, to find where the build put its menu.
  h.calls.length = 0;
  await h.advance(1);
  const spans = drawnTextRuns(h);

  for (const item of TITLE_ITEMS) {
    const span = spanOf(spans, item);
    assertNotNull(span, `the ${item} item is drawn on the title`);
    if (span === null) continue;
    // Dead on the run: its horizontal middle, at its anchor's height.
    h.debug.pointerDown((span.left + span.right) / 2, span.y);
    h.debug.pointerUp();
    const after = h.snapshot();
    assertEqual(after.screen, "title", `the screen after pressing ${item}`);
    assertEqual(after.menuIndex, 0, `the highlight after pressing ${item}`);
  }

  // And nothing surfaces a frame later either.
  await h.advance(1);
  captureStill(h, "title");
  assertEqual(h.snapshot().screen, "title");
  assertEqual(h.snapshot().menuIndex, 0);
});
