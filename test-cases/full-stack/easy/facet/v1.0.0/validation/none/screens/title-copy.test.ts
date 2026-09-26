// Facet — screens/title-copy: the title screen shows the copy specs/ui.md fixes
// for it.
//
// specs/ui.md gives the title three pieces of copy under names of its own —
// TITLE_TEXT (`FACET`), TAGLINE_TEXT (`PRESSURE FINDS THE FLAW`) and the two
// entries of TITLE_ITEMS (`PLAY`, `HOW TO PLAY`). This point is that a player
// can actually read the screen the game rests on: a build whose state says
// `title` while the frame draws nothing has no title screen, and one that draws
// the heading but never the menu leaves the player with no way to see what
// `confirm` would take.
//
// THE STATE THE SCREEN RESTS IN IS NOT THIS POINT. That `reset()` leaves the
// game on `title` with its first item highlighted is
// `instrumentation/reset-restores-every-field`'s, and it is read here only as
// the fixture that says the frame below is the title's.
//
// The copy is read through `frameText`, which hands back a frame's draw calls
// and the page's own rendered DOM text alike, because specs/assets.md has an
// engineless build draw its chrome "in code (canvas or DOM)" and this point is
// not about which of the two it chose. `frameShows` then decides whether the
// copy is on screen — the calls through the shared harness's `drewTextAnywhere`,
// the document by the same reading — across every shape specs/ui.md leaves open:
// one call per line, one per word, one per glyph, or an entry decorated with a
// highlight marker, since the specification fixes the words and fixes no font,
// no layout and no call count.
//
// `reset()` is the route because specs/instrumentation.md defines it as
// restoring "the title screen with its first menu item highlighted", which
// reaches the screen without depending on any key or any other screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  frameShows,
  shownText,
  type FrameText,
  type Harness,
} from "../harness";

let h: Harness;

/**
 * The frame put `wanted` on screen, or the failure names the copy the screen
 * owes beside every string the frame actually showed.
 */
function requireCopy(frame: FrameText, wanted: string): void {
  if (!frameShows(frame, wanted)) {
    fail(
      `the title screen to show ${JSON.stringify(wanted)}`,
      shownText(frame),
    );
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the title, the tagline and every menu item", async () => {
  await h.debug.reset();

  // The fixture: the frame read below is the title's.
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the game opens on",
  );

  // One frame, and everything it put on screen. The still is that same frame.
  const frame = await h.frameText();
  await captureStill(h, "title");

  requireCopy(frame, TITLE_TEXT);
  requireCopy(frame, TAGLINE_TEXT);
  // Both entries, each on its own: `frameShows` can find a phrase spanning two
  // adjacent draws, so the menu is asked about one item at a time rather than
  // as a joined run that a single long draw would answer for.
  for (const item of TITLE_ITEMS) requireCopy(frame, item);
});
