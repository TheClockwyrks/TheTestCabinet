// screens/gameover-returns — leaving the game-over screen returns to the title.
//
// THE RULE. `specs/ui.md` closes the `gameover` section with "Leaving the screen
// does what `MENU` does", and the `MENU` row above it reads "Returns to `title`,
// with the title's highlight at the first entry". So one sentence fixes both
// readings this check takes: the screen, and the entry the highlight came to rest
// on. `specs/controls.md` gives `back` the meaning "Leave the screen" on a screen
// showing no live play and reads it as a press edge, "once per press".
//
// WHY IT MATTERS. This is the fourth of the four screens `back` is read on, and
// the one a player reaches involuntarily. A build that wired the other three and
// forgot this one strands a lost player on the score they died at.
//
// THE SCREEN IS POSED, THE LEAVING IS DRIVEN. `setScreen("gameover")` reaches the
// scenario directly (`specs/instrumentation.md`), so how the screen is REACHED
// stays `screens/game-over-on-the-last-life`'s point; the leave itself has to be a
// real press, since no operation of the surface leaves a screen.
//
// THE ACTION IS DRIVEN, NOT THE KEY, because which key raises `back` is
// `controls/back-escape`'s point. What is under this one is where leaving goes.
//
// WHAT THIS ITEM DOES NOT DECIDE. What the game-over screen shows
// (`screens/game-over-shows-the-score` and its sibling), or where its own entries
// lead (`screens/play-again-starts-a-game`,
// `screens/game-over-menu-returns-to-the-title`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  tapAction,
  type Harness,
} from "../harness";

/** The run posed behind the screen: figures no fresh title screen holds. */
const POSED_SCORE = 2680;
const POSED_WAVE = 5;

/** Where `specs/ui.md` leaves the title's highlight on this return. */
const FIRST_ENTRY = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when the game-over screen is left", async () => {
  h.debug.reset();
  h.debug.setScore(POSED_SCORE);
  h.debug.setWave(POSED_WAVE);
  h.debug.setLives(0);
  h.debug.setScreen("gameover");
  assertEqual(
    h.snapshot().screen,
    "gameover",
    "the screen the back press was made on",
  );

  await tapAction(h, "back");
  captureStill(h, "title");

  const left = h.snapshot();
  assertEqual(
    left.screen,
    "title",
    "the screen leaving the game-over screen returns to (specs/ui.md)",
  );
  assertEqual(
    left.menuIndex,
    FIRST_ENTRY,
    "the title entry the highlight comes to rest on (specs/ui.md)",
  );
});
