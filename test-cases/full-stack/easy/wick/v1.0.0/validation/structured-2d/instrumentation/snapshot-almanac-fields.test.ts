// Wick — instrumentation/snapshot-almanac-fields: on `almanac`, `almanacTab`
// reads the tab the screen is showing and `almanacScroll` reads the list's
// first visible row; both are `0` on every other screen.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Snapshot shape": "`almanacTab`: the tab the almanac is showing",
// "`almanacScroll`: the almanac list's first visible row", and "`almanacTab`
// and `almanacScroll` sit beside `menuIndex`, outside `run`, and are `0` on
// every screen but `almanac`". What the two fields are reading is fixed by
// `specs/ui.md`, `almanac`: "`left` and `right` move `almanacTab` by one over
// `ALMANAC_TABS`, wrap at both ends, and set `menuIndex` and `almanacScroll`
// to `0`", and "`almanacScroll` follows the highlight: after every move of
// `menuIndex` it becomes the lesser of `almanacScroll` and `menuIndex`, then
// the greater of that and `menuIndex − ALMANAC_ROWS + 1`".
//
// WHAT IS READ, AND WHY. The two fields off the snapshot, at three moments a
// build that stored nothing, or stored one of them and derived the other,
// reads differently: on arriving, after a tab change, and after the highlight
// has walked past the last visible row. A field that always read `0`, or one
// that never came back to `0` off the screen, fails here.
//
// THE DRIVE. `setScreen("almanac")`, then two `right` presses onto `ENEMIES`
// (`ALMANAC_TABS` index 2), then `ALMANAC_ROWS` `down` presses. `ENEMIES`
// holds the thirteen of `ENEMY_IDS` (`specs/ui.md`), so the highlight reaches
// `menuIndex` `ALMANAC_ROWS` without wrapping and the scroll rule puts the
// window's first row at `menuIndex − ALMANAC_ROWS + 1`, which is `1`. Then
// `title` and an isolated `playing` run, where both fields read `0` again.
//
// THE TOLERANCE. None: both fields are whole indices the specification names
// exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_ROWS, ALMANAC_TABS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  poseScreen,
  tap,
  type Harness,
} from "../harness";

/** The tab the drive selects: `ENEMIES`, the third of `ALMANAC_TABS`. */
const POSED_TAB = 2;

/**
 * The first visible row once the highlight sits on `menuIndex`
 * `ALMANAC_ROWS`: `max(almanacScroll, menuIndex - ALMANAC_ROWS + 1)` from a
 * scroll of `0` (`specs/ui.md`, `almanac`).
 */
const POSED_SCROLL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads the almanac's tab and its first visible row, and 0 off the screen", async () => {
  const opened = poseScreen(h, "almanac");
  assertEqual(opened.almanacTab, 0, "almanacTab on arriving at the almanac");
  assertEqual(
    opened.almanacScroll,
    0,
    "almanacScroll on arriving at the almanac",
  );

  for (let press = 0; press < POSED_TAB; press += 1) {
    await tap(h, "ArrowRight");
  }
  const turned = h.snapshot();
  assertEqual(
    turned.almanacTab,
    POSED_TAB,
    `almanacTab reads the tab shown, ${ALMANAC_TABS[POSED_TAB]}`,
  );
  assertEqual(turned.almanacScroll, 0, "almanacScroll after a tab change");

  for (let press = 0; press < ALMANAC_ROWS; press += 1) {
    await tap(h, "ArrowDown");
  }
  const scrolled = h.snapshot();
  await h.frameDraw();
  captureStill(h, "fields");
  assertEqual(
    scrolled.menuIndex,
    ALMANAC_ROWS,
    "menuIndex after ten down presses on a thirteen-entry tab",
  );
  assertEqual(
    scrolled.almanacTab,
    POSED_TAB,
    "almanacTab held across the highlight moving",
  );
  assertEqual(
    scrolled.almanacScroll,
    POSED_SCROLL,
    "almanacScroll reads the list's first visible row",
  );

  const title = poseScreen(h, "title");
  assertEqual(title.almanacTab, 0, "almanacTab on title");
  assertEqual(title.almanacScroll, 0, "almanacScroll on title");

  const playing = isolate(h);
  assertEqual(playing.almanacTab, 0, "almanacTab on playing");
  assertEqual(playing.almanacScroll, 0, "almanacScroll on playing");
});
