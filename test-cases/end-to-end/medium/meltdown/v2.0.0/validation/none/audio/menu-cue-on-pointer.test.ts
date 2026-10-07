// Meltdown — audio/menu-cue-on-pointer — the pointer reaching a menu row sounds the
// menu cue on the frame the highlight changes.
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
// WHAT IS AND IS NOT OBSERVABLE HERE is set out in `audio/cues`: the sound and its
// frame can be read from outside an engineless build, the cue's NAME cannot.
//
// THE SECOND ROW, NOT THE FIRST. `specs/controls.md` has "moving onto the already
// highlighted row change[] nothing and raise[] nothing", so the pointer is moved
// onto the row the screen is NOT posed on and the move is a change.
//
// THE POINTER IS DRIVEN AT THE RECTANGLE THE BUILD REPORTED, which is what makes
// this decidable at all: `specs/screens.md` leaves the layout of a menu to the
// build and has it report each row's rectangle. That the rectangles are reported
// is `screens.menu-rows-reported`'s requirement.
//
// AND IT IS CHROMIUM'S OWN MOUSE, never the surface's `pointerMove`:
// `specs/instrumentation.md` has no operation of that surface play a cue, so a
// posed move is entitled to be silent and only a genuine pointer event can raise
// this one.
//
// THE SCREEN IS THE TITLE, WHERE THE GAME OPENS AND WHERE NOTHING ELSE IS RUNNING.
// No run is being played, so no other event of the ten has anything to answer and
// every sound in the window belongs to the highlight.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  menuRow,
  watchCues,
  type Harness,
} from "../harness";
import { TITLE_ITEMS } from "../constants";
import { framesOutside, mouseMove, soundsOn } from "./cues";

/** The row the screen is posed on, so the move has somewhere to move from. */
const POSED_ROW = 0;

/** The row the pointer is moved onto: the second, which is not the posed one. */
const REACHED_ROW = TITLE_ITEMS.length - 1;

/** Quiet title driven before the move, so "on no frame before it" reads across one. */
const QUIET_FRAMES = framesFor(0.3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame the pointer moves the highlight, and on no other", async () => {
  await h.debug.reset();
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(POSED_ROW);
  await h.advance(1);
  const posed = await h.snapshot();
  await h.armAudio();

  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const row = menuRow(await h.snapshot(), REACHED_ROW, "hovering a menu row");
  const frame = await mouseMove(h, row.x + row.w / 2, row.y + row.h / 2);
  const sounds = soundsOn(played, frame);
  const reached = await h.snapshot();

  await captureStill(h, "menu");

  assertEqual(posed.screen, "title", "the screen the move is made on");
  assertEqual(posed.menuIndex, POSED_ROW, "the row the move starts from");
  assertEqual(
    reached.menuIndex,
    REACHED_ROW,
    "the row the pointer reached, moved into the rectangle the build reported " +
      "for it (specs/controls.md)",
  );
  assertGreaterThan(
    sounds,
    0,
    `sounds emitted on frame ${frame}, the frame the pointer moved the ` +
      `highlight on (specs/controls.md)`,
  );
  assertDeepEqual(
    framesOutside(played, [frame]),
    [],
    "the frames of every sound emitted away from the move",
  );
});
