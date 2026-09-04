// audio/menu-cue — moving the title menu's highlight sounds a cue on the frame it
// moves, once per move.
//
// `specs/audio.md`'s cue table: `menu` answers "A menu highlight moves", and every
// cue is "raised by the frame that resolves the event it answers, and ... played
// from the frame loop". `specs/screens.md` fixes the move: "`up` and `down` move
// the highlight one row, and the highlight wraps at both ends: moving down from
// the last row highlights the first ... This holds on every menu in the game." The
// title draws "the two rows of `TITLE_ITEMS`, `PLAY` and `HOW TO PLAY`", and
// `specs/instrumentation.md` has `reset` restore `menuIndex` to `0`.
//
// WHAT IS AND IS NOT OBSERVABLE HERE is set out in `audio/cues`: the sound and its
// frame can be read from outside an engineless build, the cue's NAME cannot.
//
// TWO MOVES, NOT ONE, BECAUSE THE ITEM SAYS A MOVE SOUNDS. One move can only show
// that a build sounded at all; two moves with a resting stretch between them
// separate a build that cues each move from one that cues only the first, one that
// cues the frames between, and one that blips per frame. The second move is the
// WRAP — down from the last row to the first — which `specs/screens.md` makes a
// move by the same rule, so the pair also covers the edge a build is most likely
// to have treated as no move at all.
//
// THE SCREEN IS THE TITLE, WHERE THE GAME OPENS AND WHERE NOTHING ELSE IS RUNNING.
// No run is being played, so no other event of the ten has anything to answer and
// every sound in the window belongs to the highlight. Nothing is posed at all: the
// harness has already reset the game, so this is the screen and the row
// `specs/instrumentation.md` says a reset leaves behind, and the check reads both
// back before it presses anything.
//
//
// AND THE POINTER PATH, BECAUSE THE RULE IS STATED OF BOTH. `specs/controls.md`:
// "Moving onto a row of the menu the current screen shows makes that row the
// highlighted row, exactly as `up` and `down` reaching it do, and raises the
// `menu` cue on the frame the highlight changes." A build that sounds for the
// keyboard and stays silent under the pointer has met half the rule, so the last
// leg moves the pointer into the rectangle the build reported for a row it is not
// already on and reads the frame the highlight changed on. Both legs exercise the
// same cue on the same rule, so they share one verdict.
//
// THE KEY IS A REAL ONE, held through Chromium's own input pipeline and released
// the moment the highlight has moved. `specs/controls.md` reads every action "as a
// press edge" that "fires once per press", and holding a key "fires its action
// exactly once, however long it is held" — so exactly one move happens whether the
// build latches the edge in its keyboard layer or compares held state at the top
// of its update, and this point decides neither.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  hoverMenuRow,
  watchCues,
  type Harness,
} from "../harness";
import { TITLE_ITEMS } from "../constants";
import { framesOutside, moveHighlight, soundsOn } from "./cues";

/** Where the highlight rests on the title (`specs/instrumentation.md`'s reset). */
const FIRST_ROW = 0;

/**
 * Where one move down leaves it, and where a second wraps it back to.
 *
 * `TITLE_ITEMS` carries two rows (`specs/screens.md`), so down from the first
 * highlights the second and down from the second wraps round to the first.
 */
const SECOND_ROW = TITLE_ITEMS.length - 1;
const WRAPPED_ROW = 0;

/** Quiet title driven before the first move, and again between the two. */
const QUIET_FRAMES = framesFor(0.3);
const GAP_FRAMES = framesFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame of each move, by key or by pointer, and on no other", async () => {
  // The harness has already reset the game, so this is the title with its
  // highlight on the first of two rows.
  await h.advance(1);
  const opened = await h.snapshot();
  await h.armAudio();

  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const first = await moveHighlight(h);
  const firstFrame = first.frame;
  const firstSounds = soundsOn(played, firstFrame);

  await h.advance(GAP_FRAMES);

  const second = await moveHighlight(h);
  const secondFrame = second.frame;
  const secondSounds = soundsOn(played, secondFrame);

  await h.advance(GAP_FRAMES);

  // The pointer path: onto the row the highlight is NOT on, so the move is a
  // change rather than a hover of the row already highlighted.
  await hoverMenuRow(h, SECOND_ROW);
  const pointerFrame = h.frame();
  const pointerSounds = soundsOn(played, pointerFrame);
  const reached = await h.snapshot();

  await captureStill(h, "menu");

  assertEqual(opened.screen, "title", "the screen the game opens on");
  assertEqual(
    opened.menuIndex,
    FIRST_ROW,
    "the row the highlight rests on before anything is pressed",
  );
  assertEqual(first.hit, true, "the movement action to move the highlight");
  assertEqual(
    first.snapshot.menuIndex,
    SECOND_ROW,
    `the row the first move highlights, of ${TITLE_ITEMS.length}`,
  );
  assertEqual(second.hit, true, "the movement action to move it again");
  assertEqual(
    second.snapshot.menuIndex,
    WRAPPED_ROW,
    "the row the second move wraps the highlight round to",
  );

  assertGreaterThan(
    firstSounds,
    0,
    `sounds emitted on frame ${firstFrame}, the frame of the first move`,
  );
  assertGreaterThan(
    secondSounds,
    0,
    `sounds emitted on frame ${secondFrame}, the frame of the wrapping move`,
  );
  assertEqual(
    reached.menuIndex,
    SECOND_ROW,
    "the row the pointer reached, moved into the rectangle the build reported " +
      "for it (specs/controls.md)",
  );
  assertGreaterThan(
    pointerSounds,
    0,
    `sounds emitted on frame ${pointerFrame}, the frame the pointer moved the ` +
      `highlight on (specs/controls.md)`,
  );
  assertDeepEqual(
    framesOutside(played, [firstFrame, secondFrame, pointerFrame]),
    [],
    "the frames of every sound emitted away from the three moves",
  );
});
