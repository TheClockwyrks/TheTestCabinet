// screens/title-draws-its-copy — the title screen draws the copy specs/ui.md
// fixes.
//
// THE REQUIREMENT. `specs/ui.md` fixes the title's copy exactly: `TITLE_TEXT`
// (`ARC FOUNDRY`), `TAGLINE_TEXT` (`GROUND THE LOAD`) and `TITLE_ITEMS`
// (`SALVAGE`, `HOW TO PLAY`, in that order), and `specs/instrumentation.md` has
// `reset` return the game to that screen at menu index `0`.
//
// WHICH ENTRY IS HIGHLIGHTED is a separate requirement, decided by
// `screens/title-marks-the-selection`: a build that draws every word of its copy
// and marks no selection has missed one requirement rather than both.
//
// HOW IT IS DECIDED. The frame's own text draws carry the title, the tagline and
// both menu entries. Matching is by substring and ignores case, because
// `specs/ui.md` leaves the layout, the palette and the type to the build and a
// menu entry is commonly drawn with a marker beside it.

import { afterEach, beforeEach, it } from "vitest";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
import { assertEqual } from "../assert";
import { drewText } from "../case-harness/text";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws its title, its tagline and both menu entries", async () => {
  h.debug.reset();
  const calls = await h.frameCalls();
  captureStill(h, "title");

  const opened = h.snapshot();
  assertEqual(
    opened.screen,
    "title",
    "the screen a reset returns the game to (specs/ui.md)",
  );
  assertEqual(
    opened.menuIndex,
    0,
    "the highlighted entry on arriving at the title (specs/ui.md)",
  );

  assertEqual(
    drewText(calls, TITLE_TEXT),
    true,
    `the title screen to draw TITLE_TEXT, ${TITLE_TEXT} (specs/ui.md)`,
  );
  assertEqual(
    drewText(calls, TAGLINE_TEXT),
    true,
    `the title screen to draw TAGLINE_TEXT, ${TAGLINE_TEXT} (specs/ui.md)`,
  );
  for (const item of TITLE_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `the title screen to draw its ${item} entry (specs/ui.md)`,
    );
  }
});
