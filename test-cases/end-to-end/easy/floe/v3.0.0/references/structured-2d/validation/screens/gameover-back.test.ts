// Floe — screens/gameover-back: the back action on the game-over screen returns to
// the title, with the entry that started the run selected.
//
// `specs/ui.md`, the `victory`, `gameover` row of the transitions table: "Back —
// Returns to `title`", and under the table: "`QUIT TO MENU`, `MENU`, and Back
// from `victory` or `gameover` all return to `title` with `CROSS` selected,
// `TITLE_ITEMS` index `0`, `CROSS` being the entry that started the run."
//
// FOUR WAYS OFF THE TWO END SCREENS ARE FOUR POINTS. `MENU` and back are two
// inputs, and the victory screen and the game-over screen are two screens a build
// can get right on one and wrong on the other. This is back on the game-over
// screen; `screens.gameover-menu` is its `MENU` entry.
//
// THE HIGHLIGHT IS ON THE ENTRY BACK IS NOT. `specs/ui.md` gives back the same
// destination whichever entry is highlighted, so the pose leaves the highlight on
// `PLAY AGAIN` — the entry whose confirm would start a fresh run — and a build
// that answered back by confirming the highlight lands on `playing` and is named
// for it rather than merely reading "not `title`".
//
// THE SELECTION IS HALF THE CLAIM. A build that lands on the title with the
// second entry highlighted has left the player one confirm away from `HOW TO
// PLAY` where the run they just finished sat, so the screen and the index are
// asserted together.
//
// THE SCREEN IS POSED RATHER THAN PLAYED TO. `specs/progression.md` puts this
// screen behind a whole run, and reaching it that way would make one defect cost
// several points; `progression.game-over-at-zero` grades the path itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENDING_ITEMS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  tapAction,
  type Harness,
} from "../harness";
import { poseEnding } from "./screens";

/** The level the run reached, which the game-over screen reports. */
const REACHED_LEVEL = 6;

/** The entry the pose leaves highlighted: `PLAY AGAIN`, which back must ignore. */
const PLAY_AGAIN_INDEX = ENDING_ITEMS.indexOf("PLAY AGAIN");

/** The title entry every route back from a run selects: `CROSS`, index `0`. */
const CROSS_ITEM = TITLE_ITEMS.indexOf("CROSS");

/** One frame after the press, so the still shows the title rather than the screen. */
const SETTLE_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title with CROSS selected on a back action", async () => {
  await poseEnding(h, "gameover", REACHED_LEVEL);
  h.debug.setMenuIndex(PLAY_AGAIN_INDEX);

  const posed = h.snapshot();
  assertEqual(posed.screen, "gameover", "the pose opened the game-over screen");
  assertEqual(
    posed.menuIndex,
    PLAY_AGAIN_INDEX,
    `the pose highlighted ${ENDING_ITEMS[PLAY_AGAIN_INDEX]}, which back must ignore`,
  );

  await tapAction(h, "back");
  await h.advance(SETTLE_TICKS);
  captureStill(h, "title");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "the back action on the game-over screen returns to the title (specs/ui.md)",
  );
  assertEqual(
    after.menuIndex,
    CROSS_ITEM,
    `with ${TITLE_ITEMS[CROSS_ITEM]} selected, the entry that started the run ` +
      `(specs/ui.md)`,
  );
});
