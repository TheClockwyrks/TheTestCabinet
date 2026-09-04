// screens/quit-returns-to-the-play-entry — quitting a match puts the title's
// highlight back on the entry that started it.
//
// THE RULE. `specs/ui.md`, on `paused`: `QUIT TO MENU` "Returns to `title`, with
// the title's highlight on `PLAY`, the entry that led away into the match", and on
// `title`: "The highlight rests on the first entry when the game opens and on every
// return from a game, where `PLAY` is the entry that led away". `TITLE_ITEMS` is
// `PLAY`, `HOW TO PLAY` in that order, so the entry is index `0`.
//
// WHY IT IS A POINT OF ITS OWN. `screens/quit-returns-to-the-title` decides the
// SCREEN. A build that lands on the title with the highlight left wherever the
// pause menu had it must grade differently from one that gets both right, so the
// highlight is read here and nowhere else. `screens/howto-returns-to-its-entry` is
// the same rule read on the other return, where the answer is the other entry.
//
// AND THE READING IS NOT VACUOUS. The pause menu's highlight is posed on entry `2`,
// `QUIT TO MENU`, so a build that simply carried its menu index across the
// transition reports `2` here rather than the `0` the specification asks for.
//
// THE ENTRY IS ADDRESSED, NOT COUNTED. `setMenuIndex(2)` places the highlight
// directly; counting presses onto it would grade `controls/menu-down-arrow` a
// second time. The confirm is a real key, because `specs/instrumentation.md`
// carries no operation that takes a menu entry.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS, TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  tapAction,
  ticksFor,
  type Harness,
} from "../harness";

/** The entry the highlight is posed on: `QUIT TO MENU`, the third. */
const QUIT = 2;

/** The title entry that leads away into a match (`specs/ui.md`). */
const PLAY_ENTRY = 0;

/** The quiet stretch driven on the pause screen before the press, in ticks. */
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

it("comes back to the PLAY entry the match was started from", async () => {
  assertEqual(
    PAUSE_ITEMS[QUIT],
    "QUIT TO MENU",
    "the third entry of the pause menu specs/ui.md fixes",
  );
  assertEqual(
    TITLE_ITEMS[PLAY_ENTRY],
    "PLAY",
    "the title entry specs/ui.md puts first",
  );

  // The pause menu over the empty, quiet field `startPlaying` leaves, with the
  // highlight posed on the third entry.
  startPlaying(h);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(QUIT);

  await h.advance(QUIET_TICKS);
  const before = h.snapshot();

  await tapAction(h, "confirm");
  const after = h.snapshot().menuIndex;

  await h.advance(PICTURE_TICKS);
  captureStill(h, "title");

  assertEqual(
    before.menuIndex,
    QUIT,
    "the highlighted entry the press was taken on, posed through " +
      "setMenuIndex (specs/instrumentation.md)",
  );
  assertEqual(
    after,
    PLAY_ENTRY,
    `the title entry highlighted after confirming ` +
      `${JSON.stringify(PAUSE_ITEMS[QUIT])} — specs/ui.md returns to title ` +
      `with the highlight on ${JSON.stringify(TITLE_ITEMS[PLAY_ENTRY])}, the ` +
      "entry that led away into the match",
  );
});
