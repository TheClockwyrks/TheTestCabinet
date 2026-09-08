// screens/title-draws-the-sites-entry — the title screen draws its `SITES` menu
// entry.
//
// `specs/ui.md` § The screens, Title: "The game opens on `title`, showing
// `TITLE_TEXT` (`GANTRY`), `TAGLINE_TEXT` (`RIG THE CRANE. RUN THE TAPE.`), and
// the menu `TITLE_ITEMS` (`SITES`, `HOW TO PLAY`), with `menuIndex` `0` on
// arriving." The copy is the case's; how it is set is the build's.
//
// THAT SENTENCE NAMES FOUR PIECES OF COPY, and each is a check of its own: a
// title screen that draws its title and forgets its tagline has to grade above
// one that draws neither, and one point over the four could not tell them
// apart. The order the two menu entries stand in is a fifth,
// `screens/title-draws-its-menu-entries-in-order`. This one decides the first
// entry of `TITLE_ITEMS`, `SITES`.
//
// WHAT IS READ IS THE FRAME'S OWN TEXT, not the snapshot: the snapshot says
// which screen is showing and says nothing about what was drawn on it, and a
// title screen that draws none of its copy is exactly the miss this item is
// about. The reading is the operations the build issued against its 2D context
// on the last frame, which `h.screenCalls()` answers with every text call
// measured.
//
// MATCHING IGNORES HOW THE COPY IS BROKEN UP AND SPACED. A build is free to
// draw a menu entry with a selection marker beside it, to letter-space a title
// into one call per glyph, or to set the tagline over two lines, so the copy is
// read with the shared harness's `drewTextAnywhere`: the frame's logical runs
// joined in reading order with the whitespace folded out, matched as a
// substring ignoring case, rather than against one `fillText` argument. What is
// asserted is that the copy was drawn, and never a position, a font, or a
// colour.

import { afterEach, beforeEach, it } from "vitest";
import { drawnTextLines, drewTextAnywhere } from "../case-harness/text";
import { assertTrue, fail } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the SITES menu entry", async () => {
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(0);
  await h.advance(1);

  const calls = await h.screenCalls();
  await h.capture("sites-entry", "The title screen's SITES entry");

  const lines = drawnTextLines(calls);
  assertTrue(
    lines.length > 0,
    "the title screen to draw text at all (specs/ui.md)",
  );

  if (!drewTextAnywhere(calls, TITLE_ITEMS[0])) {
    fail(
      `the title screen to draw "${TITLE_ITEMS[0]}" (specs/ui.md)`,
      `it drew ${JSON.stringify(lines)}`,
    );
  }
});
