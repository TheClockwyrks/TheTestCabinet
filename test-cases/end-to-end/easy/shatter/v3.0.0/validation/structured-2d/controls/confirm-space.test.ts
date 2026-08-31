// controls/confirm-space — `Space` confirms a menu selection.
//
// `specs/controls.md`'s bindings table gives the `confirm` action TWO keys,
// `Enter` and `Space`, and its Menus section says what confirming does:
// "Confirming takes the highlighted entry, and `specs/ui.md` states each
// screen's entries and where each leads." `specs/ui.md` states that entry: the
// title menu's first is `PLAY`, which "Opens a new game ... and moves to
// `playing`."
//
// `Space` IS TRIPLE-BOUND, AND THE SCREEN SETTLES IT. The same key drives `a`
// and `b` — the gun — as well as `confirm`, and `specs/controls.md` resolves
// that by the screen: "`Space` likewise drives firing while the game is being
// played and confirms on a screen showing a menu." A real `Space` key event
// raises all three actions at once, so a build has to read the one the screen
// calls for. Driving the KEY rather than an action is what puts that in front of
// the build; `harness.ts`'s `tapAction` would raise one named action and ask it
// nothing. That ambiguity, and the fact that a build may register `Enter` alone,
// is the whole reason this item stands apart from `controls/confirm-enter`.
//
// THE TITLE, POSED AT ITS FIRST ENTRY. `reset` restores the title screen, and
// the highlight is then posed at entry `0` outright rather than assumed —
// `PLAY` is entry `0` of `TITLE_ITEMS`, and posing it is the direct route the
// guidance asks for. That leaves the reading a single move: the screen the
// press led to.
//
// AND THE SCREEN IS THE KEY'S DOING. A quarter second is driven on the title
// first with nothing down, and the screen is read at the end of it: a build that
// walks off its own title screen on a timer rather than on a press is caught
// there rather than passing here.
//
// THE READING IS TAKEN AT THE PRESS, THE PICTURE AFTER IT. The verdict rests on
// the snapshot taken the instant the key landed; the frames driven afterwards
// are for the still alone, so the reviewer sees the opening wave the press
// produced rather than the blank instant it produced it on.
//
// WHAT THIS DOES NOT DECIDE. What a new game holds — `screens/play-starts-a-game`
// decides the lives and the score `PLAY` opens with. Nor what `Space` does while
// the game is being played (`controls/fire-space`), nor the other key bound to
// `confirm`.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  ticksFor,
  type Harness,
} from "../harness";

/** The key this point is about, as `specs/controls.md`'s table names it. */
const KEY = "Space";

/** The entry the highlight is posed on: `PLAY`, the first of `TITLE_ITEMS`. */
const PLAY = 0;

/** The quiet stretch driven on the title before the key goes down, in ticks. */
const QUIET_TICKS = ticksFor(0.25);

/** Frames driven after the press for the still alone, in ticks. */
const PICTURE_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts a game when Space is pressed on the title menu's first entry", async () => {
  // The title screen a fresh `reset` leaves, with the highlight posed on `PLAY`.
  resetTo(h);
  h.debug.setMenuIndex(PLAY);

  await h.advance(QUIET_TICKS);
  const before = h.snapshot();

  await h.tap(KEY);
  const after = h.snapshot().screen;

  await h.advance(PICTURE_TICKS);
  captureStill(h, "confirmed");

  assertEqual(
    before.screen,
    "title",
    `the screen after ${String(QUIET_TICKS)} ticks on the title with no key ` +
      "down — the game opens on the title (specs/ui.md) and leaves it only on " +
      "a confirmed entry (specs/controls.md)",
  );
  assertEqual(
    before.menuIndex,
    PLAY,
    "the highlighted entry the press was taken on, posed through " +
      "setMenuIndex (specs/instrumentation.md)",
  );
  assertEqual(
    after,
    "playing",
    `the screen on the tick ${KEY} was pressed with the title menu on entry ` +
      `${String(PLAY)} of ${String(TITLE_ITEMS.length)}, ` +
      `${JSON.stringify(TITLE_ITEMS[PLAY])} — Space confirms on a screen ` +
      "showing a menu (specs/controls.md) and PLAY opens a new game and moves " +
      "to playing (specs/ui.md)",
  );
});
