// screens/gameover-returns — leaving the game-over screen returns to the title.
//
// `specs/ui.md` closes the `gameover` section with "Leaving the screen does what
// `MENU` does", and the `MENU` row above it reads "Returns to `title`, with the
// title's highlight at the first entry". One sentence therefore fixes both
// readings taken here: the screen, and the entry the highlight came to rest on.
// `specs/controls.md` gives `back` the meaning "Leave the screen" on a screen
// showing no live play and reads it as a press edge, "once per press".
//
// WHY THIS SCREEN. It is the fourth of the four screens `back` is read on, and
// the only one a player reaches involuntarily: a build that wired the other three
// and forgot this one strands a lost player on the score they died at.
//
// THE SCREEN IS POSED DIRECTLY. `setScreen("gameover")` is the operation
// `specs/instrumentation.md` provides for exactly this, and it "spawns nothing and
// clears nothing", so how the screen is REACHED stays
// `screens/game-over-on-the-last-life`'s point.
//
// THE ACTION IS DRIVEN, NOT THE KEY, because which key raises `back` is
// `controls/back-escape`'s point.
//
// AND THE RETURN IS THE PRESS'S DOING. A quarter second runs on the game-over
// screen with nothing down and the screen is read at the end of it, so a build
// whose game-over screen times out on its own is caught before the press.
//
// WHAT THIS DOES NOT DECIDE. What the screen shows
// (`screens/game-over-shows-the-score` and its sibling), or where its own entries
// lead (`screens/play-again-starts-a-game`,
// `screens/game-over-menu-returns-to-the-title`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  ticksFor,
  type Harness,
} from "../harness";

/** The run posed behind the screen: figures no fresh title screen holds. */
const POSED_SCORE = 2680;
const POSED_WAVE = 5;

/** Where `specs/ui.md` leaves the title's highlight on this return. */
const FIRST_ENTRY = 0;

/** The quiet stretch driven on the game-over screen before the press, in ticks. */
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

it("returns to the title when back is pressed on the game-over screen", async () => {
  resetTo(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setWave(POSED_WAVE);
  h.debug.setLives(0);
  h.debug.setScreen("gameover");

  await h.advance(QUIET_TICKS);
  const before = h.snapshot().screen;

  await tapAction(h, "back");
  const after = h.snapshot();

  await h.advance(PICTURE_TICKS);
  captureStill(h, "title");

  assertEqual(
    before,
    "gameover",
    `the screen after ${String(QUIET_TICKS)} ticks on the posed game-over ` +
      "screen with no key down — a screen is left on a press, not on a timer " +
      "(specs/ui.md, specs/controls.md)",
  );
  assertEqual(
    after.screen,
    "title",
    "the screen on the tick back was pressed on the game-over screen — " +
      "leaving it does what MENU does (specs/ui.md)",
  );
  assertEqual(
    after.menuIndex,
    FIRST_ENTRY,
    "the title entry the highlight comes to rest on, which MENU fixes as the " +
      "first (specs/ui.md)",
  );
});
