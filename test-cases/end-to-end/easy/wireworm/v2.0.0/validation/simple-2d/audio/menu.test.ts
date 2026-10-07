// audio/menu — moving a menu selection plays the menu cue.
//
// specs/ui.md fixes `CUES.menu` (`"menu"`) as the cue played when "a menu
// highlight moves", and governs all ten with one sentence: "Each is played on the
// frame its event happens and at most once on that frame."
//
// So the measurement is: move the title menu's highlight with the real key, one
// frame per press, and read what sounded on that frame against what sounded over a
// quarter second of the same menu sitting untouched.
//
// A PRESS IS ONE FRAME, WHICH IS WHAT MAKES THE READING EXACT. specs/controls.md
// reads `up` and `down` as press edges, "once per press", and the harness's `tap`
// runs exactly the one frame that delivers the edge. So the cues announced across
// that single `tap` are the cues of the move's own frame, with nothing to
// attribute them to but the move.
//
// TWO MOVES, DOWN THEN UP, BECAUSE THE REQUIREMENT IS "ONCE PER MOVE". Reading one
// move would pass a build that sounds the cue on the first move of a screen and
// then falls silent. Down and back up rather than down twice: `TITLE_ITEMS` holds
// two items, so down-then-up moves the highlight from the first to the second and
// back without ever asking the menu to wrap, and whether it wraps is
// `screens.title-menu-wraps-down`'s requirement rather than this point's.
//
// THE SCREEN AND THE HIGHLIGHT ARE POSED. `setScreen` and `setMenuIndex` put the
// game on the title with its highlight on the first item (specs/instrumentation.md
// ), so the check reads a menu it placed rather than one it assumed, and the two
// moves it then makes are both moves between real items.
//
// WHAT THIS DOES NOT DECIDE. That `up` and `down` move a menu highlight is
// `controls.menu-up`'s and `controls.menu-down`'s requirement, and what the title
// menu holds is `screens.title-screen`'s. This point reads the cue alone.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, CUES, TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";

/** The keys specs/controls.md binds the two menu actions to first. */
const MENU_DOWN_KEY = BINDINGS.down[0];
const MENU_UP_KEY = BINDINGS.up[0];

/** The highlight the title opens on, and the item one move down from it. */
const FIRST_ITEM = 0;
const SECOND_ITEM = 1;

/**
 * Frames of silence driven on the untouched menu before the first press.
 *
 * A quarter of a second, which at the suite's clock is thirty frames of a screen
 * on which specs/ui.md has nothing at all happening. A build that sounds its menu
 * cue on a timer, or on every frame a menu is shown, has to get through all of
 * them silently.
 */
const QUIET_LEAD = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.menu once on the frame of each title-menu move, and not while the menu sits still", async () => {
  h.debug.setScreen("title");
  h.debug.setMenuIndex(FIRST_ITEM);
  assertEqual(
    TITLE_ITEMS.length,
    SECOND_ITEM + 1,
    "posing: the title menu holds the two items the two moves run between " +
      "(specs/ui.md)",
  );

  const quiet = h.cues.length;
  await h.advance(QUIET_LEAD);
  assertEqual(
    h.cues.slice(quiet).filter((one) => one.cue === CUES.menu).length,
    0,
    `times CUES.menu played over the ${String(QUIET_LEAD)} frames the title ` +
      "menu sat untouched (specs/ui.md: a cue is played on the frame its " +
      "event happens)",
  );

  const onDown = h.cues.length;
  await h.tap(MENU_DOWN_KEY);
  assertEqual(
    h.snapshot().menuIndex,
    SECOND_ITEM,
    `the highlight the ${MENU_DOWN_KEY} press moved to, from the first item ` +
      "(specs/controls.md)",
  );
  assertEqual(
    h.cues.slice(onDown).filter((one) => one.cue === CUES.menu).length,
    1,
    "times CUES.menu played on the frame the highlight moved down, which is " +
      "its own frame and at most once on it (specs/ui.md)",
  );

  const onUp = h.cues.length;
  await h.tap(MENU_UP_KEY);
  captureStill(h, "menu");
  assertEqual(
    h.snapshot().menuIndex,
    FIRST_ITEM,
    `the highlight the ${MENU_UP_KEY} press moved to, from the second item ` +
      "(specs/controls.md)",
  );
  assertEqual(
    h.cues.slice(onUp).filter((one) => one.cue === CUES.menu).length,
    1,
    "times CUES.menu played on the frame the highlight moved back up, which " +
      "is once per move rather than once per screen (specs/ui.md)",
  );
});
