// screens/howto-returns-to-its-entry — the return from the how-to lands on the
// entry that opened it.
//
// `specs/ui.md`, on `title`: "The highlight rests on the first entry when the game
// opens and on every return from a game... a return from `howto` puts the
// highlight back on `HOW TO PLAY`, the entry that opened that screen." The `howto`
// section gives the mechanism: "the title's highlight is left exactly as it was
// while this screen shows". `TITLE_ITEMS` is `PLAY`, `HOW TO PLAY` in that order,
// so the entry that opens the how-to is index `1`.
//
// WHY IT MATTERS. A player who opens the instructions and comes back finds the
// highlight where they left it, so a second confirm does not start a game they did
// not ask for.
//
// THE SCREEN IS REACHED THROUGH THE TITLE, WHICH IS THE POINT. Every other check
// in this group poses `howto` with `setScreen`, which never touches the title menu
// and would leave the index this check reads undefined. Here the how-to is opened
// the way a player opens it: the highlight is addressed with `setMenuIndex`, the
// direct route that does not lean on the move bindings the `controls` group
// grades, and the entry is confirmed through the registered action.
//
// WHAT THIS DOES NOT DECIDE. That confirming `HOW TO PLAY` opens the screen
// (`screens/howto-reachable`) or that leaving it reaches the title at all
// (`screens/howto-returns`). Both are read back here only as the preconditions
// this check cannot proceed without.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  ticksFor,
  type Harness,
} from "../harness";

/** The title entry that opens the how-to screen (`specs/ui.md`). */
const HOW_TO_PLAY = 1;

/** Frames driven after the return for the still alone, in ticks. */
const PICTURE_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("comes back to the HOW TO PLAY entry the how-to was opened from", async () => {
  assertEqual(
    TITLE_ITEMS[HOW_TO_PLAY],
    "HOW TO PLAY",
    "the title entry specs/ui.md puts second",
  );

  resetTo(h);
  h.debug.setMenuIndex(HOW_TO_PLAY);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the screen the entry was taken from");
  assertEqual(
    posed.menuIndex,
    HOW_TO_PLAY,
    "the entry the highlight was posed on",
  );

  await tapAction(h, "confirm");
  assertEqual(
    h.snapshot().screen,
    "howto",
    "the screen confirming HOW TO PLAY opened",
  );

  await tapAction(h, "back");
  const back = h.snapshot();

  await h.advance(PICTURE_TICKS);
  captureStill(h, "title");

  assertEqual(
    back.screen,
    "title",
    "the screen leaving the how-to returns to (specs/ui.md)",
  );
  assertEqual(
    back.menuIndex,
    HOW_TO_PLAY,
    "the title entry highlighted on the return from the how-to (specs/ui.md)",
  );
});
