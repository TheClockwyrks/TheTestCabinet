// screens/title-screen-tagline — the title screen carries a tagline.
//
// specs/ui.md: the `title` screen shows "The title `TITLE_TEXT` (`DEEPCORE`), a
// tagline, and the main menu".
//
// WHAT A TAGLINE IS READ AS. specs/ui.md fixes no words for it, so this reads a
// run of drawn text that is neither the title nor one of the menu entries and is
// long enough to be a phrase rather than a stray glyph — copy on the screen
// beyond its name and its menu, which is the whole of what the specification
// states.
//
// FOUR POINTS, NOT ONE. specs/ui.md names four things about this screen — that
// the game is on it and it carries the title, that it carries a tagline, that it
// carries the main menu, and that the highlighted entry is drawn distinctly — and
// a build that gets three of them right must grade differently from one that gets
// none. The other three are `screens/title-screen-tagline`,
// `screens/title-menu-drawn` and `screens/title-menu-highlight-is-distinct`.
//
// ISOLATION. A fresh harness reset to its resting state with the save slot
// cleared, so the menu is the one specs/ui.md lists with no save banked and
// nothing on the screen belongs to an expedition.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { TITLE_ITEMS_NO_SAVE, TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  drawnText,
  type Harness,
} from "../harness";

/** The shortest run of text that counts as a tagline rather than a stray glyph. */
const TAGLINE_MIN = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows a tagline beside its name and its menu", async () => {
  await h.debug.setAutoStep(false);
  await h.debug.clearSave();
  await h.debug.reset();

  const calls = await h.frameCalls();
  await captureStill(h, "tagline");

  const named: readonly string[] = [TITLE_TEXT, ...TITLE_ITEMS_NO_SAVE].map(
    (text) => text.toUpperCase(),
  );
  const tagline = drawnText(calls)
    .map((run) =>
      run
        .toUpperCase()
        .replace(/[^A-Z0-9 ]/g, " ")
        .trim(),
    )
    .filter((text) => text.length >= TAGLINE_MIN && !named.includes(text));

  assertGreaterThan(
    tagline.length,
    0,
    "specs/ui.md: the title screen shows a tagline beside its name and menu",
  );
});
