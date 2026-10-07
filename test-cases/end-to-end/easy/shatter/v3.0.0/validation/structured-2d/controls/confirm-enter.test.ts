// controls/confirm-enter — `Enter` confirms a menu selection.
//
// `specs/controls.md` binds `Enter` to the `confirm` action and gives `confirm`
// its meaning on a menu — "Confirm the selection" — and its Menus section says
// what confirming does: "Confirming takes the highlighted entry, and
// `specs/ui.md` states each screen's entries and where each leads."
// `specs/ui.md` states that entry: the title menu's first is `PLAY`, which
// "Opens a new game ... and moves to `playing`."
//
// THE KEY IS DRIVEN, NOT THE ACTION. `specs/instrumentation.md` carries no
// operation that confirms an entry, and this point is about one BINDING, so the
// literal `KeyboardEvent.code` the specification's table names is what goes
// down. `harness.ts`'s `tapAction` and `startRun` drive an action's FIRST bound
// key, which would grade `Enter` and `Space` as one thing; the whole point of
// this item and of `controls/confirm-space` is that they are two.
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
// decides the lives and the score `PLAY` opens with, and the wave it lays is
// `waves/wave-one-spawns-four`'s. Nor the second entry
// (`screens/howto-reachable`), nor the other key bound to `confirm`.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  ticksFor,
  type Harness,
} from "../harness";

/** The key this point is about, as `specs/controls.md`'s table names it. */
const KEY = "Enter";

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

it("starts a game when Enter is pressed on the title menu's first entry", async () => {
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
      `${JSON.stringify(TITLE_ITEMS[PLAY])} — Enter confirms the selection ` +
      "(specs/controls.md) and PLAY opens a new game and moves to playing " +
      "(specs/ui.md)",
  );
});
