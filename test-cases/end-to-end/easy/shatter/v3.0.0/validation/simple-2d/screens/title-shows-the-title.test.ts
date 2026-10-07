// screens/title-shows-the-title — the game opens on a title screen that names
// itself.
//
// THE RULE. `specs/ui.md` gives the `title` screen two pieces of fixed copy: the
// title `TITLE_TEXT` (`SHATTER`) and the tagline `TAGLINE_TEXT`
// (`GRAVITY WELL SHOOTER`), each named as an element of the screen, and it names
// `title` as "the main menu, and where the game opens". So the frame a freshly
// opened game draws must carry both.
//
// WHAT IS READ. The frame's own text draws, through the canvas the engine handed
// the build — not the game's state, which says nothing about what was painted. A
// build that reported the title screen and drew a blank field fails here, which is
// the point of reading the canvas rather than the snapshot. The screen is read
// back as well, so a build that drew the copy on some other screen is not credited
// with a title screen it never showed.
//
// MATCHING IS BY CONTAINMENT, not equality. `specs/ui.md` fixes the words and
// leaves the type and the layout to the build, so a title drawn with a subtitle on
// the same line, or a tagline drawn inside a longer strapline, has drawn the copy
// the specification names. Case and the whitespace between words are likewise the
// build's: the reading is the shared harness's `drewText` (`case-harness/text.ts`),
// over the logical runs the frame spells along each baseline — so a title drawn a
// glyph per `fillText` is read as the word it spells — with the whitespace folded
// out of both sides.
//
// THE ROUTE. `reset()` and one tick. `specs/instrumentation.md` restores `screen`
// to `"title"`, so this is the state a player sees on load, reached without
// touching a key — and the tick is needed because `initialize` runs the build's
// setup and nothing else, so nothing has been drawn until a frame runs.
//
// WHAT THIS ITEM DOES NOT DECIDE. The MENU on the title screen, which is
// `screens/title-menu-entries`, nor which entry is highlighted, which is
// `screens/title-menu-highlight`, nor whether the copy is legible against what is
// behind it, which the reviewer judges.

import { afterEach, beforeEach, it } from "vitest";
import { TAGLINE_TEXT, TITLE_TEXT } from "../constants";
import { assertEqual, fail } from "../assert";
import { drawnTextLines, drewText } from "../case-harness/text";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the title and the tagline on the screen the game opens on", async () => {
  h.debug.reset();

  // One frame, recorded on its own, so what is read is this frame's draws alone.
  h.clearCalls();
  await h.advance(1);
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen specs/instrumentation.md says reset restores",
  );

  // A failure prints the runs the frame DID draw, beside the copy it lacks.
  if (!drewText(h.calls, TITLE_TEXT)) {
    fail(
      "the title TITLE_TEXT drawn on the title screen (specs/ui.md)",
      drawnTextLines(h.calls),
    );
  }
  if (!drewText(h.calls, TAGLINE_TEXT)) {
    fail(
      "the tagline TAGLINE_TEXT drawn on the title screen (specs/ui.md)",
      drawnTextLines(h.calls),
    );
  }
});
