// navigation/title-remembers-versus — MENU after a Versus match returns to the
// title on VERSUS.
//
// specs/ui.md, "The remembered title selection": confirming an item on the title
// menu sets `titleIndex` to that item's index. And "Returning to the title":
// `MENU` on the match-over screen restores `menuIndex` from `titleIndex`. The
// match was started by confirming `VERSUS`, the second of `TITLE_ITEMS`, so the
// title a finished match returns to is on `VERSUS` — the entry that started it,
// and not the `SOLO` a fresh title sits on.
//
// `titleIndex` is posed onto `HOW TO PLAY` before the confirm, so the `VERSUS`
// confirm has something to overwrite and a build that never writes the field
// reads back `2` rather than the figure this point names. That the remembered
// entry is `1` here and `0` in `title-remembers-solo` is the point of the pair:
// what comes back is the entry that was confirmed, not a constant.
//
// Two real keys, and they are the two this point is about: the `Enter` that
// confirms `VERSUS` and the `Enter` that confirms `MENU`. The finished match
// between them is POSED — the score, the winner, the selection and the screen,
// the four atomic poses `openMatchOver` makes — because driving twenty-two scored
// points to grade one remembered selection would fail this point whenever the
// scoring rule was broken, and `ui/state-matchover` is where a real win is played
// out. `navigation/matchover-menu` grades the return itself over a match posed
// rather than confirmed, and reads back the `0` a fresh title carries.
//
// The field is emptied. The check passes through a real countdown, which is the
// one screen here that advances anything, and this point concerns neither a ball
// nor an obstacle; `clearWorld` removes them outright rather than parking them
// somewhere harmless.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MATCHOVER_ITEMS, WIN_SCORE } from "../constants";
import {
  captureStill,
  clearField,
  createHarness,
  type Harness,
} from "../harness";
import { TITLE_HOWTO, TITLE_VERSUS, selectTitle } from "./screens";

/** The match-over menu's second entry (specs/ui.md, `MATCHOVER_ITEMS`). */
const MENU = MATCHOVER_ITEMS.indexOf("MENU");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title on VERSUS", async () => {
  await selectTitle(h, TITLE_VERSUS);
  await h.debug.setTitleIndex(TITLE_HOWTO);
  assertEqual((await h.snapshot()).titleIndex, TITLE_HOWTO);

  await h.tap("Enter");
  const started = await h.snapshot();
  assertEqual(started.screen, "countdown");
  assertEqual(started.mode, "versus");
  assertEqual(started.titleIndex, TITLE_VERSUS);

  await clearField(h);
  await h.debug.setScore(WIN_SCORE, 0);
  await h.debug.setWinner("left");
  await h.debug.setMenuIndex(MENU);
  await h.debug.setScreen("matchover");

  await h.tap("Enter");
  await captureStill(h, "title");

  const title = await h.snapshot();
  assertEqual(title.screen, "title");
  assertEqual(title.titleIndex, TITLE_VERSUS);
  assertEqual(title.menuIndex, TITLE_VERSUS);
});
