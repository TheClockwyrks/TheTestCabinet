// Facet — keyboard/back-key: `Escape`, pressed on the how-to screen, fires
// `back` and leaves it.
//
// specs/controls.md binds `back` to `Escape` and gives it one effect: "Leaves
// `howto` and `gameover`." The same key is bound to `pause`, and the
// specification keeps the pair apart by screen — "`pause` acts on `playing` and
// `paused` and nowhere else, `back` on `howto` and `gameover` and nowhere else",
// so "`Escape` raises the pause menu from the board, drops it again, and backs
// out of every other screen that can be backed out of."
//
// SO THE POINT IS THE OTHER HALF OF `keyboard/pause-escape`. That check presses
// the key on a screen only `pause` acts on; this one presses it on a screen only
// `back` acts on. A build that let `pause` swallow the key on every screen passes
// there and leaves `howto` standing here, and a build that routed the key to
// `back` alone fails there and passes here — which is what makes the pair two
// points rather than one.
//
// WHAT IS DECIDED HERE IS ONLY THAT THE SCREEN IS LEFT. Where the key lands, and
// with which item highlighted, is `screens/back-leaves-howto`'s point:
// specs/ui.md sends `back` from `howto` to `title` "with the `HOW TO PLAY` item
// of `TITLE_ITEMS` highlighted", and reading that here would be answering that
// point's question with this point's gesture. The reading is therefore the
// negative the item states — the screen the key was pressed on is not the screen
// standing after it — which a build that binds the key satisfies however it wired
// the landing.
//
// The screen is reached through `openHowTo()`, which specs/instrumentation.md
// defines as the choice of `HOW TO PLAY` "exactly as choosing that item does", so
// nothing here depends on where that item sits in the title menu.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { BINDINGS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

/** The one key specs/controls.md binds the `back` action to. */
const BACK_KEY = BINDINGS.back[0];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`leaves the how-to screen when ${BACK_KEY} is pressed on it`, async () => {
  await h.debug.reset();
  await h.debug.openHowTo();

  const before = await h.snapshot();
  assertEqual(before.screen, "howto", "the screen the key is pressed on");

  // A real press of the bound key, delivered as an edge one frame reads — never
  // a pose, which would arrange a screen change while saying nothing about the
  // binding.
  await h.tap(BACK_KEY);

  // The frame the press ran is the first frame off the how-to screen.
  await captureStill(h, "left");

  const after = await h.snapshot();
  assertNotEqual(
    after.screen,
    "howto",
    `the screen after ${BACK_KEY}, which the back action leaves`,
  );
});
