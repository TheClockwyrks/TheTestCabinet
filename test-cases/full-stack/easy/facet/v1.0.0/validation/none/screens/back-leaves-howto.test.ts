// Facet — screens/back-leaves-howto: `back` puts the player back on the item
// they came in through.
//
// specs/ui.md gives the how-to screen one way out and says exactly where it
// leads: "`back` returns to `title` with the `HOW TO PLAY` item of
// `TITLE_ITEMS` highlighted, so a player who came in to read the rules is put
// back where they were rather than at the top of the menu."
//
// THE HIGHLIGHT IS THE WHOLE OF THIS POINT. That the key leaves the screen at
// all is `keyboard/back-key`'s, and which screen it lands on is settled the
// moment the highlight is read, since only the title carries `TITLE_ITEMS`.
// specs/ui.md puts `menuIndex` at `0` on arriving at every other screen and on
// arriving at the title "from anywhere but `howto`", so this is the ONE arrival
// in the whole game at an index other than `0` — which is precisely why a build
// that zeroes the index on every screen change passes everything else and fails
// exactly here.
//
// THE INDEX IS COMPUTED FROM THE MENU rather than written down. specs/ui.md
// fixes `TITLE_ITEMS` as `PLAY`, `HOW TO PLAY`, in that order, so the item's own
// position in that list is the figure the screen owes, and the fixture asserts
// it is not `0` before the press — a menu whose second entry sat first would
// make this point undecidable, and it fails as the fixture fault it would be.
//
// THE KEY IS REAL. `tapAction` delivers `back`'s first binding in
// specs/controls.md's table, which that file fixes for a build of every engine,
// as one press the frame reads as an edge. `Escape` fires `pause` as well, and
// specs/controls.md keeps the two apart by screen — `pause` acts on `playing`
// and `paused` and nowhere else — so on `howto` the press is unambiguous.
//
// The screen is reached through `openHowTo()`, which specs/instrumentation.md
// defines as the choice of `HOW TO PLAY` "exactly as choosing that item does",
// so nothing here depends on how the player got in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** Where `HOW TO PLAY` sits in the title menu specs/ui.md fixes. */
const HOW_TO_PLAY_INDEX = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title with HOW TO PLAY highlighted, on the back key", async () => {
  // The fixture's own guarantee: the item this point is about is not the first
  // one, so the index below says something the `0` of every other arrival does
  // not.
  assertGreaterThan(
    HOW_TO_PLAY_INDEX,
    0,
    "where HOW TO PLAY sits in TITLE_ITEMS",
  );

  await h.debug.reset();
  await h.debug.openHowTo();

  const opened = await h.snapshot();
  assertEqual(opened.screen, "howto", "the screen back is pressed on");
  assertEqual(opened.menuIndex, 0, "the highlight on a screen with no menu");

  await h.tapAction("back");

  const left = await h.snapshot();
  await captureStill(h, "title");
  assertEqual(left.screen, "title", "the screen back returns to");
  assertEqual(
    left.menuIndex,
    HOW_TO_PLAY_INDEX,
    "the title item highlighted on coming back out of how-to",
  );
});
