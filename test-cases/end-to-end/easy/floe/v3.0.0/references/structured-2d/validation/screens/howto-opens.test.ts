// Floe — screens/howto-opens: confirming the second title item opens the how-to
// screen.
//
// `specs/ui.md`, the title row of the transitions table: "Confirm — `CROSS`
// starts a run and opens `playing`; `HOW TO PLAY` opens `howto` with `menuIndex`
// at `0`." This point decides the second half of that clause: with the SECOND
// entry of `TITLE_ITEMS` highlighted, one confirm leaves the game on `howto`.
//
// THE HIGHLIGHT IS POSED, THE CONFIRM IS A REAL KEY. `setMenuIndex` puts the
// highlight on the entry this transition is about, because moving it there with
// the down key would make the point fail for a build whose menu keys are broken —
// that is `controls/menu-down`, and it is graded there. The confirm itself
// travels the whole route: the key `BINDINGS` gives `confirm` is dispatched at
// the event target the engine listens on, the engine resolves it to the
// registered action and arms its edge, and the build reads that action back.
// `specs/instrumentation.md` gives the surface no keyboard operation at all, so
// there is no shorter way in.
//
// ONE FIELD IS READ. The screen, and not what the how-to screen then says
// (`screens.howto-contents`), nor what leaves it (`screens.howto-returns`), nor
// that `Enter` confirms at all (`controls/confirm-enter`). A build that opens the
// right screen and fills it with nothing keeps this point and loses those.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/** The title entry this transition belongs to: `HOW TO PLAY`, the second. */
const HOWTO_INDEX = 1;

/**
 * One frame after the press, so the still shows the screen the confirm opened.
 *
 * Nothing is measured across it: the press is delivered inside `tapAction`'s own
 * frame, and the reading below is taken after this one either way.
 */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the how-to screen when HOW TO PLAY is confirmed", async () => {
  resetTo(h);
  h.debug.setMenuIndex(HOWTO_INDEX);

  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the reset opened the title screen");
  assertEqual(
    posed.menuIndex,
    HOWTO_INDEX,
    `the pose highlighted ${TITLE_ITEMS[HOWTO_INDEX]}, the second title item`,
  );

  await tapAction(h, "confirm");
  await h.advance(SETTLE_FRAMES);
  captureStill(h, "howto");

  assertEqual(
    h.snapshot().screen,
    "howto",
    `confirming ${TITLE_ITEMS[HOWTO_INDEX]} opens the how-to screen (specs/ui.md)`,
  );
});
