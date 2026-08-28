// Refract — screens/pointer-ignores-menus: the pointer does not operate menus.
//
// specs/ui.md "Menu navigation": menus are keyboard only — the pointer draws
// beams, and the menus are driven by the registered actions alone. So a press
// and release on each of the title menu's drawn items must change nothing:
// screen and menuIndex read back exactly as they were.
//
// The presses are REAL pointer events through the engine's own input path —
// `h.pointer` maps a logical point through the live viewport, the way a
// player's pointer arrives — and each is aimed at where the item's text was
// actually drawn, read off the frame's own draw calls via `drawnTextSpans`, so
// the press lands on the item wherever the build laid its menu out. A title
// that never drew one of its items fails here on the missing item, named.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../../src/constants";
import { assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
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

/** Where `item` was drawn on the last frame, or a failure naming it. */
function spanOf(spans: readonly TextSpan[], item: string): TextSpan {
  const wanted = item.toLowerCase();
  const span = spans.find((s) => s.text.toLowerCase().includes(wanted));
  if (span === undefined) {
    return fail(
      `the title frame draws the ${item} menu item to press on (specs/ui.md)`,
      spans.map((s) => s.text),
    );
  }
  return span;
}

it("a press and release on each drawn title item changes nothing", async () => {
  await resetTo(h);
  h.calls.length = 0;
  await h.advance(1);
  const spans = drawnTextSpans(h);

  for (const item of TITLE_ITEMS) {
    const span = spanOf(spans, item);
    const x = (span.left + span.right) / 2;
    const y = span.y;

    h.pointer("pointerdown", x, y);
    await h.advance(1);
    h.pointer("pointerup", x, y);
    await h.advance(1);

    const snapshot = h.snapshot();
    assertEqual(
      snapshot.screen,
      "title",
      `a press and release on ${item} leaves the screen unchanged ` +
        "(specs/ui.md: the pointer does not operate menus)",
    );
    assertEqual(
      snapshot.menuIndex,
      0,
      `a press and release on ${item} leaves menuIndex unchanged ` +
        "(specs/ui.md: menus are driven by the registered actions alone)",
    );
  }

  captureStill(h, "title");
});
