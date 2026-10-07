// Carom — navigation/title-remembers-solo: quitting a Solo match returns to the
// title on SOLO.
//
// One requirement of the menu state machine specs/ui.md fixes, in one direction.
// "The remembered title selection" says confirming an item on the title menu sets
// `titleIndex` to that item's index, and "Returning to the title" says QUIT TO
// MENU restores `menuIndex` from `titleIndex`. The match was started by confirming
// `SOLO`, the first of `TITLE_ITEMS`, so the title it quits back to is on `SOLO`.
//
// `titleIndex` IS POSED ONTO `HOW TO PLAY` BEFORE THE CONFIRM, and that pose is
// what lets this point fail. `SOLO` is index `0` and a fresh title already
// remembers `0`, so a build that never writes `titleIndex` would read back the
// right figure by accident; posing the entry a player was last on leaves the
// `SOLO` confirm something to overwrite, and a forgetful build reads back the `2`.
// `setTitleIndex` is the one operation that sets that field
// (specs/instrumentation.md), and it sets nothing else.
//
// Two real key events, and they are the two this point is about: the `Enter` that
// confirms `SOLO` and the `Enter` that confirms `QUIT TO MENU`, each dispatched at
// the target the runtime listens on. Everything between them is posed — `openPause`
// is the three fields specs/ui.md says a `pause` edge sets, and `setMenuIndex(2)`
// puts the selection on the third entry — because pressing `Escape` to open that
// menu is `controls-solo/escape`'s point and pressing down to the entry is the
// pause menu's own. `navigation/pause-quit` grades the return over a match posed
// rather than confirmed, and reads back the `0` a fresh title carries.
//
// The field is emptied. This point passes through a real countdown, the one screen
// here that advances anything, and it concerns no ball and no obstacle; `poseWorld`
// removes them outright rather than parking them somewhere harmless. The paddles
// are furniture the field always has, and nothing here takes one: no menu is driven
// through a paddle. The still is the frame the second press left.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS, TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openPause,
  openTitle,
  poseWorld,
  type Harness,
} from "../harness";

const SOLO = 0;
const HOWTO = 2;
const QUIT = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title on SOLO", async () => {
  assertEqual(TITLE_ITEMS[SOLO], "SOLO");
  assertEqual(PAUSE_ITEMS[QUIT], "QUIT TO MENU");
  openTitle(h);
  h.debug.setMenuIndex(SOLO);
  h.debug.setTitleIndex(HOWTO);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, SOLO);
  assertEqual(posed.titleIndex, HOWTO);

  await h.tap("Enter");
  const started = h.snapshot();
  assertEqual(started.screen, "countdown");
  assertEqual(started.mode, "solo");
  assertEqual(started.titleIndex, SOLO);

  poseWorld(h, { balls: [], obstacles: [] });
  openPause(h, "countdown");
  h.debug.setMenuIndex(QUIT);
  assertEqual(h.snapshot().screen, "paused");

  await h.tap("Enter");
  captureStill(h, "title");

  const title = h.snapshot();
  assertEqual(title.screen, "title");
  assertEqual(title.titleIndex, SOLO);
  assertEqual(title.menuIndex, SOLO);
});
