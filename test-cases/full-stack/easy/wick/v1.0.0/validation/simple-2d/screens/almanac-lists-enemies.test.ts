// screens/almanac-lists-enemies — the ENEMIES tab lists every enemy, in order.
//
// WHAT THIS DECIDES. One thing: the enemies tab's list holds the thirteen enemy
// names in `ENEMY_IDS` order, drawn one below the next, ten rows at a time.
// What the highlighted entry SHOWS is `almanac-shows-enemy-detail`'s point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`, the entries table): "`ENEMIES` | the thirteen of
//   `ENEMY_IDS`".
//   specs/ui.md (`almanac`): "the entries of that tab listed down the left",
//   "The list shows `ALMANAC_ROWS` (`10`) entries at a time, beginning at the
//   entry at `almanacScroll`", and "Each row shows its entry's name."
//   specs/ui.md (`almanac`, the parts table): "Name | ... the enemy's from
//   `ENEMIES`".
//
// THE DRIVE. The almanac through `setScreen("almanac")`, then two `ArrowRight`
// presses to reach the enemies tab through the screen's own key, and one frame
// for the first ten names. The list is then walked to its last entry with
// `ArrowDown` and back up by one window with `ArrowUp`, which leaves the window
// on the last ten entries with the highlight on the FIRST of them, and a second
// frame is read for those. Reading the second window with the highlight at its
// top matters: the detail pane draws the highlighted entry's name a second
// time, and the topmost anchor of a name drawn twice is the higher of the two,
// which can only pull the FIRST row of a window upward.
//
// THE TOLERANCE. Each name is matched as a run of text holding it, so a build
// that marks the highlighted row or draws a shadow under its text passes; the
// order is read as a strict inequality between the topmost anchor of each
// name, which admits any pitch, font, alignment and place the build chose.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_ENTRY_NAMES, ALMANAC_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import {
  DOWN_KEY,
  UP_KEY,
  assertNamesDown,
  tabIndex,
  tapTimes,
  walkToTab,
} from "./almanac";

let h: Harness;

/** The thirteen names, in the order specs/ui.md's entries table gives them. */
const NAMES = ALMANAC_ENTRY_NAMES.ENEMIES;
/** The window's first row once the list has been walked to its end: three. */
const BOTTOM = NAMES.length - ALMANAC_ROWS;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lists the thirteen enemy names down the frame, in order", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the frames are read from");

  const staged = await walkToTab(h, "ENEMIES");
  assertEqual(
    staged.almanacTab,
    tabIndex("ENEMIES"),
    "the tab the list is read on",
  );
  assertEqual(staged.almanacScroll, 0, "the list's first row on the new tab");

  const top = await h.frameDraw();
  captureStill(h, "enemies");
  assertNamesDown(
    top.calls,
    NAMES.slice(0, ALMANAC_ROWS),
    "the first window of the enemies tab",
  );

  await tapTimes(h, DOWN_KEY, NAMES.length - 1);
  const walked = await tapTimes(h, UP_KEY, ALMANAC_ROWS - 1);
  assertEqual(walked.menuIndex, BOTTOM, "the entry the second window opens on");
  assertEqual(walked.almanacScroll, BOTTOM, "the second window's first row");

  const bottom = await h.frameDraw();
  assertNamesDown(
    bottom.calls,
    NAMES.slice(BOTTOM),
    "the last window of the enemies tab",
  );
});
