// Facet — screens/title-screen: the game rests on the title with its first menu
// item highlighted, showing the copy specs/ui.md fixes for that screen.
//
// specs/ui.md gives the title three pieces of copy under names of its own —
// TITLE_TEXT (`FACET`), TAGLINE_TEXT (`PRESSURE FINDS THE FLAW`) and the two
// entries of TITLE_ITEMS (`PLAY`, `HOW TO PLAY`) — and states that `menuIndex`
// is `0` on arriving at the title. This point is those two halves together: the
// state the screen rests in, and that a player can actually read the screen it
// rests on. A build whose state says `title` while the frame draws nothing has
// no title screen, and one that draws the heading but never the menu leaves the
// player with no way to see what `confirm` would take.
//
// The copy is read through `frameText`, which gathers a frame's canvas text and
// the page's own DOM text alike, because specs/assets.md has an engineless
// build draw its chrome "in code (canvas or DOM)" and this point is not about
// which of the two it chose. `showsText` then decides whether the copy is on
// screen across every shape specs/ui.md leaves open — one call per line, one
// per word, one per glyph, or an entry decorated with a highlight marker —
// since the specification fixes the words and fixes no font, no layout and no
// call count.
//
// `reset()` is the route because specs/instrumentation.md defines it as
// restoring "the title screen with its first menu item highlighted", which is
// the state this point is about, and it reaches that state without depending on
// any key or any other screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  showsText,
  type Harness,
} from "../harness";

let h: Harness;

/**
 * The frame put `wanted` on screen, or the failure names the copy the screen
 * owes beside every string the frame actually drew.
 */
function requireCopy(drawn: readonly string[], wanted: string): void {
  if (!showsText(drawn, wanted)) {
    fail(`the title screen to show ${JSON.stringify(wanted)}`, drawn);
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("rests on the title, first item highlighted, showing its title, tagline and menu", async () => {
  await h.debug.reset();

  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the screen the game opens on");
  assertEqual(opened.menuIndex, 0, "the highlighted item on arriving");

  // One frame, and everything it put on screen. The still is that same frame.
  const drawn = await h.frameText();
  await captureStill(h, "title");

  requireCopy(drawn, TITLE_TEXT);
  requireCopy(drawn, TAGLINE_TEXT);
  // Both entries, each on its own: `showsText` can find a phrase spanning two
  // adjacent draws, so the menu is asked about one item at a time rather than
  // as a joined run that a single long draw would answer for.
  for (const item of TITLE_ITEMS) requireCopy(drawn, item);
});
