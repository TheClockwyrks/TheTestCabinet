// screens/title-draws-its-copy — the title screen draws its title, its tagline
// and both menu entries.
//
// THE REQUIREMENT. `specs/ui.md` fixes the title's copy exactly: `TITLE_TEXT`
// (`ARC FOUNDRY`), `TAGLINE_TEXT` (`GROUND THE LOAD`) and `TITLE_ITEMS`
// (`SALVAGE`, `HOW TO PLAY`, in that order). `specs/instrumentation.md` has
// `reset` return the game to the title with the menu index at `0`.
//
// HOW IT IS DECIDED. Two readings of the same frame. The state: after `reset` the
// screen reads `title` with `menuIndex` `0`. The copy: the frame's own text draws
// carry the title, the tagline and both menu entries. Matching is by substring
// and ignores case, because `specs/ui.md` leaves the layout, the palette and the
// type to the build and a menu entry is commonly drawn with a marker beside it.
//
// Which entry is drawn as the current one is a second requirement, and
// `screens/title-marks-the-selection` decides that.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { drewText } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws its title, its tagline and both menu entries", async () => {
  await h.debug.reset();
  const calls = await h.frameCalls();
  await captureStill(h, "title");

  const opened = await h.snapshot();
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
