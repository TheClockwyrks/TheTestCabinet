// Floe — screens/howto-opens: confirming the second title item opens the how-to
// screen.
//
// `specs/ui.md`, the title row of the transitions table: "Confirm — `CROSS`
// starts a run and opens `playing`; `HOW TO PLAY` opens `howto` with `menuIndex`
// at `0`." This point decides the second half of that sentence's first clause:
// with the SECOND entry of `TITLE_ITEMS` highlighted, one confirm leaves the game
// on `howto`.
//
// THE HIGHLIGHT IS POSED, THE CONFIRM IS A REAL KEY. `setMenuIndex` puts the
// highlight on the entry this transition is about, because moving it there with
// the down key would make the point fail for a build whose menu keys are broken
// — that is `controls.menu-down`, and it is graded there. The confirm itself is
// pressed through Chromium's own input pipeline, so what reaches the build is a
// browser-trusted DOM key event on the real page; under this engine the whole
// keyboard layer is the build's own, `specs/instrumentation.md` giving the
// surface no keyboard operation at all.
//
// ONE FIELD IS READ. The screen, and not what the how-to screen then says
// (`screens.howto-contents`), nor what leaves it (`screens.howto-returns`), nor
// that `Enter` confirms at all (`controls.confirm-enter`). A build that opens the
// right screen and fills it with nothing keeps this point and loses those.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** The title entry this transition belongs to: `HOW TO PLAY`, the second. */
const HOWTO_INDEX = 1;

/**
 * One tick after the press, so the still shows the screen the confirm opened.
 *
 * Nothing is measured across it: the press is delivered inside `tap`'s own tick.
 */
const SETTLE_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the how-to screen when HOW TO PLAY is confirmed", async () => {
  await h.debug.reset();
  await h.debug.setMenuIndex(HOWTO_INDEX);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the reset opened the title screen");
  assertEqual(
    posed.menuIndex,
    HOWTO_INDEX,
    `the pose highlighted ${TITLE_ITEMS[HOWTO_INDEX]}, the second title item`,
  );

  await h.tap(BINDINGS.confirm[0]);
  await h.advance(SETTLE_TICKS);
  await captureStill(h, "howto");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    `confirming ${TITLE_ITEMS[HOWTO_INDEX]} opens the how-to screen (specs/ui.md)`,
  );
});
