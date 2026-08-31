// Floe — controls/confirm-enter: `Enter` confirms the highlighted menu item.
//
// `specs/controls.md` binds `Enter` and `Space` to the `confirm` action, reads
// confirm as a press edge on every screen, and fixes what it does: accept the
// highlighted menu item. `specs/ui.md` says what accepting the first item of
// `TITLE_ITEMS` does — "`CROSS` starts a run and opens `playing`" — so with
// `CROSS` highlighted, one press of `Enter` must leave the game on the `playing`
// screen.
//
// ONE BINDING OF ONE ACTION. `Enter` and `Space` are two keys bound to the same
// action and each carries its own point, so a build that wired one and left the
// other dead is graded differently from one that wired neither. The two checks are
// written identically apart from the key for exactly that reason: nothing but the
// key may decide which of the two a build fails. The key is named literally here
// rather than read off `BINDINGS`, because WHICH key is the whole of the point.
//
// THE ROUTE IS THE TITLE SCREEN, AND IT IS NOT POSED PAST. `reset` restores the
// title with `menuIndex` `0` (`specs/instrumentation.md`), which the check reads
// back and asserts before it presses anything, so the press is delivered to a menu
// genuinely showing `CROSS` highlighted rather than to a screen this check
// arranged around the build. The key itself is dispatched at the event target the
// engine listens on, so the engine's binding of `Enter` to `confirm`, its
// press-edge detection, and the build's reading of that action are every step
// between the key and the opened crossing — `specs/instrumentation.md` gives the
// surface no keyboard operation at all, so none of that path can be
// short-circuited.
//
// WHAT IS NOT GRADED HERE. What a fresh run holds — level 1, three lives, a full
// timer, five open bays, a critter on the near shore — is
// `screens.cross-starts-run`, and what the second title item confirms is
// `screens.howto-opens`. This point asks only whether `Enter` accepted the
// highlighted item, so a build whose new run is mis-initialised loses those points
// and keeps this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../../src/constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** The key this point decides, named literally: it is the whole of the point. */
const KEY = "Enter";

/** The title item the press must accept: the first of `TITLE_ITEMS`, `CROSS`. */
const POSED_INDEX = 0;

/**
 * One frame after the press, so the screen the confirm opened is the one drawn.
 *
 * Nothing is measured across it: the press is delivered inside `tap`'s own frame,
 * and this is only so the still shows the crossing rather than the title frame
 * that preceded it.
 */
const SETTLE_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a live crossing when Enter is pressed with CROSS highlighted", async () => {
  h.debug.reset();
  h.debug.setMenuIndex(POSED_INDEX);

  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the reset opened the title screen");
  assertEqual(
    posed.menuIndex,
    POSED_INDEX,
    `the title menu highlights ${TITLE_ITEMS[POSED_INDEX]}`,
  );

  await h.tap(KEY);
  await h.advance(SETTLE_TICKS);
  captureStill(h, "confirm");

  assertEqual(
    h.snapshot().screen,
    "playing",
    "Enter accepts the highlighted item, and CROSS opens a crossing (specs/controls.md, specs/ui.md)",
  );
});
