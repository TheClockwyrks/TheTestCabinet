// Carom — navigation/title-remembers-versus: MENU after a Versus match returns to
// the title on VERSUS.
//
// One requirement specs/ui.md fixes, in one direction. "The remembered title
// selection" says confirming an item on the title menu sets `titleIndex` to that
// item's index; "Returning to the title" says MENU on the match-over screen
// restores `menuIndex` from `titleIndex`. The match was started by confirming
// VERSUS, the second of TITLE_ITEMS, so the title a finished match returns to is
// on VERSUS — the entry that started it, rather than the SOLO a fresh title sits
// on.
//
// `titleIndex` is posed onto HOW TO PLAY before the confirm, so the VERSUS confirm
// has something to overwrite and a build that never writes the field reads back 2
// instead of the figure this point names. That the remembered entry is 1 here and
// 0 in navigation/title-remembers-solo is the point of the pair: what comes back
// is the entry that was confirmed, not a constant.
//
// Two keys are pressed and they are the two this point is about: the Enter that
// confirms VERSUS and the Enter that confirms MENU, each a real key event
// dispatched at the target the engine listens on. The finished match between them
// is POSED — the screen, then the score, the winner and the selection, in the
// order `openMatchOver` poses them — because winning a match for real puts every
// rule of the game between this check and the one field it reads, and the win rule
// is navigation/matchover-menu's and ui/state-matchover's to grade.
// navigation/matchover-menu also grades this return over a match posed rather than
// confirmed, and reads back the 0 a fresh title carries.
//
// The field is emptied before the screen is posed. This point passes through a
// real countdown — the one screen here that advances anything — and it concerns
// neither a ball nor an obstacle, so `clearField` removes them rather than leaving
// one behind the menu to move under a screen-changing pose. Neither paddle is
// taken from the player: this check presses menu keys alone. The still is the
// frame the second press left.

import { afterEach, beforeEach, it } from "vitest";
import { MATCHOVER_ITEMS, TITLE_ITEMS, WIN_SCORE } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  clearField,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

const VERSUS = 1;
const HOWTO = 2;
const MENU = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title on VERSUS", async () => {
  assertEqual(TITLE_ITEMS[VERSUS], "VERSUS");
  assertEqual(MATCHOVER_ITEMS[MENU], "MENU");
  await openTitle(h);
  h.debug.setMenuIndex(VERSUS);
  h.debug.setTitleIndex(HOWTO);
  assertEqual(h.snapshot().screen, "title");
  assertEqual(h.snapshot().menuIndex, VERSUS);
  assertEqual(h.snapshot().titleIndex, HOWTO);

  await h.tap("Enter");
  assertEqual(h.snapshot().screen, "countdown");
  assertEqual(h.snapshot().mode, "versus");
  assertEqual(h.snapshot().titleIndex, VERSUS);

  clearField(h);
  h.debug.setScreen("matchover");
  await h.advance(1);
  h.debug.setScore(WIN_SCORE, 0);
  h.debug.setWinner("left");
  h.debug.setMenuIndex(MENU);
  assertEqual(h.snapshot().screen, "matchover");

  await h.tap("Enter");
  captureStill(h, "title");

  const title = h.snapshot();
  assertEqual(title.screen, "title");
  assertEqual(title.titleIndex, VERSUS);
  assertEqual(title.menuIndex, VERSUS);
});
