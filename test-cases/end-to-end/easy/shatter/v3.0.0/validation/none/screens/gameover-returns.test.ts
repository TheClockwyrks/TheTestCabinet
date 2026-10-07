// Shatter — screens/gameover-returns: leaving the game-over screen returns to the
// title.
//
// THE RULE. `specs/ui.md` closes the `gameover` section with "Leaving the screen
// does what `MENU` does", and the `MENU` row above it reads "Returns to `title`,
// with the title's highlight at the first entry". So the leave has two readings —
// the screen it lands on and the entry the highlight came to rest on — and both
// are one sentence's worth of requirement. `specs/controls.md` binds `Escape` to
// "Leave the screen" on any screen that is not live play and reads it as a press
// edge, "once per press".
//
// WHY IT MATTERS. A player who has just lost and reaches for the key that means
// "get me out of here" is on the one screen where a build that wired leaving to
// three screens and forgot the fourth strands them at the score they died on.
//
// THE SCREEN IS POSED, THE LEAVING IS DRIVEN. `reachGameOver` poses the finished
// run behind the screen through the debug surface, because how the screen is
// REACHED is `screens/game-over-on-the-last-life`'s requirement; the leave itself
// has to be a real key, since `specs/instrumentation.md` carries no operation for
// it and posing the title would answer the question for the build.
//
// WHAT THIS ITEM DOES NOT DECIDE. That `Escape` leaves a screen at all
// (`controls/back-escape`), what the game-over screen shows
// (`screens/game-over-shows-the-score` and its sibling), or where the screen's own
// entries lead (`screens/play-again-starts-a-game`,
// `screens/game-over-menu-returns-to-the-title`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY_BACK } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { SETTLE_TICKS, reachGameOver } from "./screens";

/** The run posed behind the screen: figures no fresh title screen holds. */
const FINISHED_RUN = { score: 2680, wave: 5 };

/** Where `specs/ui.md` leaves the title's highlight on this return. */
const FIRST_ENTRY = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when the game-over screen is left", async () => {
  await reachGameOver(h, FINISHED_RUN);

  await h.tap(KEY_BACK);
  await h.advance(SETTLE_TICKS);
  await captureStill(h, "title");

  const left = await h.snapshot();
  assertEqual(
    left.screen,
    "title",
    "the screen leaving the game-over screen returned to (specs/ui.md)",
  );
  assertEqual(
    left.menuIndex,
    FIRST_ENTRY,
    "the title entry the highlight came to rest on (specs/ui.md)",
  );
});
