// Carom — navigation/title-remembers-versus: MENU after a Versus match returns to
// the title on VERSUS.
//
// One requirement of the menu state machine specs/ui.md fixes, in one direction.
// "The remembered title selection" says confirming an item on the title menu sets
// `titleIndex` to that item's index, and "Returning to the title" says MENU on the
// match-over screen restores `menuIndex` from `titleIndex`. The match was started
// by confirming `VERSUS`, the second of `TITLE_ITEMS`, so the title a finished
// match returns to is on `VERSUS` — the entry that started it, rather than the
// `SOLO` a fresh title sits on.
//
// `titleIndex` is posed onto `HOW TO PLAY` before the confirm, so the `VERSUS`
// confirm has something to overwrite and a build that never writes the field reads
// back `2` instead of the figure this point names. That the remembered entry is
// `1` here and `0` in `navigation/title-remembers-solo` is the point of the pair:
// what comes back is the entry that was confirmed, not a constant.
//
// Two real key events, and they are the two this point is about: the `Enter` that
// confirms `VERSUS` and the `Enter` that confirms `MENU`, each dispatched at the
// target the runtime listens on. The finished match between them is POSED —
// `openMatchOver` is `setScore`, `setWinner`, `setMenuIndex(0)` and
// `setScreen("matchover")`, and `setMenuIndex(1)` then puts the selection on
// `MENU` — because winning a match for real is `ui/state-matchover`'s point and
// pressing down to the entry is the match-over menu's own.
// `navigation/matchover-menu` grades the return over a match posed rather than
// confirmed, and reads back the `0` a fresh title carries.
//
// The field is emptied. This point passes through a real countdown, the one screen
// here that advances anything, and it concerns no ball and no obstacle; `poseWorld`
// removes them outright rather than parking them somewhere harmless. The paddles
// are furniture the field always has, and nothing here takes one. The still is the
// frame the second press left.

import { afterEach, beforeEach, it } from "vitest";
import { MATCHOVER_ITEMS, TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openMatchOver,
  openTitle,
  poseWorld,
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
  openTitle(h);
  h.debug.setMenuIndex(VERSUS);
  h.debug.setTitleIndex(HOWTO);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, VERSUS);
  assertEqual(posed.titleIndex, HOWTO);

  await h.tap("Enter");
  const started = h.snapshot();
  assertEqual(started.screen, "countdown");
  assertEqual(started.mode, "versus");
  assertEqual(started.titleIndex, VERSUS);

  poseWorld(h, { balls: [], obstacles: [] });
  openMatchOver(h, { winner: "left" });
  h.debug.setMenuIndex(MENU);
  assertEqual(h.snapshot().screen, "matchover");

  await h.tap("Enter");
  captureStill(h, "title");

  const title = h.snapshot();
  assertEqual(title.screen, "title");
  assertEqual(title.titleIndex, VERSUS);
  assertEqual(title.menuIndex, VERSUS);
});
