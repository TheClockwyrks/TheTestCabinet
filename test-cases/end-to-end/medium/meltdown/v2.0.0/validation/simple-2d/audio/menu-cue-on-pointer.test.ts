// audio/menu-cue-on-pointer: the pointer reaching a menu row plays the `menu`
// cue on the frame the highlight changes.
//
// THE RULE. `specs/controls.md`, on what moving the pointer does: "Moving onto a
// row of the menu the current screen shows makes that row the highlighted row,
// exactly as `up` and `down` reaching it do, and raises the `menu` cue on the
// frame the highlight changes."
//
// WHY THIS IS ITS OWN POINT. A build routes the keyboard and the pointer through
// different code, so one can raise the cue and the other stay silent. Graded
// together with the key path, a build that sounds for `ArrowDown` and nothing for
// the mouse would score exactly as one that sounds for neither. The key path is
// `audio.menu-cue`'s and this point says nothing about it.
//
// THE SECOND ROW, NOT THE FIRST. `specs/controls.md` has "moving onto the already
// highlighted row change[] nothing and raise[] nothing", so the pointer is moved
// onto the row the screen is NOT posed on and the move is a change.
//
// THE POINTER IS DRIVEN AT THE RECTANGLE THE BUILD REPORTED, which is what makes
// this decidable at all: `specs/screens.md` leaves the layout of a menu to the
// build and has it report each row's rectangle. That the rectangles are reported
// is `screens.menu-rows-reported`'s requirement, so a build that reports none
// fails there; this one drives what it reported.
//
// THE TITLE SCREEN IS WHERE THIS IS READ, because it is the screen a freshly reset
// game is already on and nothing else is running on it: the simulation does not
// run off the `playing` screen, so no shot, kill, leak, trip or clear is
// reachable and every cue in the window belongs to the highlight.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { CUES, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  hoverMenuRow,
  watchCues,
  type Harness,
} from "../harness";
import { playedBefore, playedOn } from "./cues";

/** The row the screen is posed on, so the move has somewhere to move from. */
const POSED_ROW = 0;

/** The row the pointer is moved onto: the second, which is not the posed one. */
const REACHED_ROW = TITLE_ITEMS.length - 1;

/**
 * Frames the title screen is held before the move, so "on no frame before it" is
 * read across a stretch of the same screen the move is then made on rather than
 * across nothing at all. Half a second at the suite's 120 Hz clock.
 */
const QUIET_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the menu cue on the frame the pointer moves the highlight", async () => {
  h.debug.reset();
  h.debug.setScreen("title");
  h.debug.setMenuIndex(POSED_ROW);
  await h.advance(1);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "posing: the screen the move is made on");
  assertEqual(posed.menuIndex, POSED_ROW, "posing: the row the move starts from");

  const played = watchCues(h);
  await h.advance(QUIET_TICKS);

  await hoverMenuRow(h, REACHED_ROW);
  const frame = h.engine.frame().count;
  captureStill(h, "menu");

  assertEqual(
    h.snapshot().menuIndex,
    REACHED_ROW,
    "the highlighted row after the pointer moved into the rectangle the " +
      "build reported for it (specs/controls.md)",
  );
  assertLength(
    playedBefore(played, frame),
    0,
    `cues that played over the ${String(QUIET_TICKS)} frames before the move — ` +
      "a cue is raised by the frame that resolves the event it answers " +
      "(specs/audio.md)",
  );
  assertDeepEqual(
    playedOn(played, frame),
    [CUES.menu],
    "the cues that played on the frame the pointer moved the highlight: the " +
      "menu cue, and nothing else (specs/audio.md, specs/controls.md)",
  );
  assertLength(
    played,
    1,
    "the cues played over the whole scenario: the one the pointer's move " +
      "raised (specs/audio.md)",
  );
});
