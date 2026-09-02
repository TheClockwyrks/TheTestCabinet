// Floe — screens/title-opens: a build that has just initialized is on the title
// screen, with the first item highlighted.
//
// `specs/ui.md` states it in one line: "A freshly loaded build opens on `title`
// with `menuIndex` at `0`." `specs/instrumentation.md` puts both in the snapshot,
// and says the shape is complete "from the moment the game has initialized", so
// the reading is available at exactly the moment this check wants it.
//
// NOTHING IS POSED, AND NOTHING IS DRIVEN FIRST. This is the one check in the
// suite whose subject is the state a build ARRIVES in, so `reset` — which is what
// every other check opens with, and which restores the same two values by
// definition (`specs/instrumentation.md`) — would erase the very thing being
// graded. The harness builds a runtime over its own canvas, awaits the build's
// `initialize`, and reads the surface `initialize` returned beside the state; it
// runs no frame of its own. The snapshot below is therefore the first thing asked
// of the build, before a key, a tick or a pose. A build whose `reset` is perfect
// and whose first screen is the crossing fails here and passes everywhere else,
// which is the grading this item is for.
//
// BOTH HALVES, BECAUSE THEY ARE ONE ARRIVAL. The screen and the highlight are the
// two fields the sentence fixes, and a build that opened on the title with its
// second item highlighted has got the arrival wrong in a way a player sees on the
// first key they press. Which item `menuIndex` `0` names, and what confirming it
// does, are `screens.title-contents` and `screens.cross-starts-run`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** The item a freshly loaded build highlights: the first of `TITLE_ITEMS`. */
const FRESH_MENU_INDEX = 0;

/**
 * One frame AFTER the reading, so the still shows the screen the build opened on.
 * Nothing is measured across it.
 */
const SETTLE_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens on the title screen with the first menu item highlighted", async () => {
  // The very first reading, before anything has been posed or driven.
  const fresh = h.snapshot();

  await h.advance(SETTLE_TICKS);
  captureStill(h, "title");

  assertEqual(
    fresh.screen,
    "title",
    "a freshly loaded build opens on the title screen (specs/ui.md)",
  );
  assertEqual(
    fresh.menuIndex,
    FRESH_MENU_INDEX,
    `and highlights ${TITLE_ITEMS[FRESH_MENU_INDEX]}, the first item, at menuIndex 0`,
  );
});
