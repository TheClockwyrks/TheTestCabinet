// Wick — instrumentation/snapshot-reports-almanac-scroll: on `almanac`,
// `almanacScroll` reads the list's first visible row, and `0` on every other
// screen.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Snapshot shape": "`almanacScroll`: the almanac list's first visible row",
// and "`almanacTab` and `almanacScroll` sit beside `menuIndex`, outside `run`,
// and are `0` on every screen but `almanac`". What the field is reading is
// fixed by `specs/ui.md`, `almanac`: "`almanacScroll` follows the highlight:
// after every move of `menuIndex` it becomes the lesser of `almanacScroll` and
// `menuIndex`, then the greater of that and `menuIndex − ALMANAC_ROWS + 1`".
// `almanacTab` is `instrumentation/snapshot-reports-almanac-tab`'s.
//
// THE DRIVE. `setScreen("almanac")`, two `right` presses onto `ENEMIES`
// (`ALMANAC_TABS` index 2), then `ALMANAC_ROWS` `down` presses. `ENEMIES`
// holds the thirteen of `ENEMY_IDS` (`specs/ui.md`), so the highlight reaches
// `menuIndex` `ALMANAC_ROWS` without wrapping and the scroll rule puts the
// window's first row at `menuIndex − ALMANAC_ROWS + 1`, which is `1`. Then
// `title` and an isolated `playing` run, where the field reads `0` again.
//
// THE TOLERANCE. None: the field is a whole index the specification names
// exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_ROWS } from "../constants";
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

it("reads the almanac list's first visible row, and 0 off the screen", async () => {
  const opened = poseScreen(h, "almanac");
  assertEqual(
    opened.almanacScroll,
    0,
    "almanacScroll on arriving at the almanac",
  );

  for (let press = 0; press < POSED_TAB; press += 1) {
    await tap(h, "ArrowRight");
  }
  const turned = h.snapshot();
  assertEqual(turned.almanacScroll, 0, "almanacScroll after a tab change");

  for (let press = 0; press < ALMANAC_ROWS; press += 1) {
    await tap(h, "ArrowDown");
  }
  const scrolled = h.snapshot();
  await h.frameDraw();
  captureStill(h, "scroll");
  assertEqual(
    scrolled.menuIndex,
    ALMANAC_ROWS,
    "menuIndex after ten down presses on a thirteen-entry tab",
  );
  assertEqual(
    scrolled.almanacScroll,
    POSED_SCROLL,
    "almanacScroll reads the list's first visible row",
  );

  const title = poseScreen(h, "title");
  assertEqual(title.almanacScroll, 0, "almanacScroll on title");

  const playing = isolate(h);
  assertEqual(playing.almanacScroll, 0, "almanacScroll on playing");
});
