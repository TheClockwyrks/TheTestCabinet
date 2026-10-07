// audio/menu — moving the title menu's highlight sounds a cue on the frame it
// moves, once per move.
//
// `specs/ui.md`'s cue table: `menu` is played when "A menu highlight moves", and
// every cue "is played on the frame its event happens and at most once on that
// frame". `specs/controls.md` fixes the move: in a menu, "`up` and `down` move
// the highlight by one item and wrap at both ends", and `specs/ui.md` gives the
// title's `TITLE_ITEMS` as `DESCEND` then `HOW TO PLAY`.
//
// WHAT IS AND IS NOT OBSERVABLE HERE is set out in `audio/cues`: the sound and
// its frame can be read from outside an engineless build, the cue's NAME cannot.
//
// TWO MOVES, NOT ONE, BECAUSE THE ITEM SAYS "ONCE PER MOVE". One move can only
// show that a build sounded at all; two moves with a resting half-second between
// them separate a build that cues each move from one that cues only the first, one
// that cues the frames between, and one that blips per frame. The second move
// wraps from the last item back to the first, which is a move by the same rule.
//
// THE SCREEN IS THE TITLE, WHERE THE GAME OPENS AND WHERE NOTHING ELSE IS
// RUNNING: no board is being played, so no other event of the ten has anything to
// answer to and every sound in the window belongs to the highlight.
//
// THE KEY IS A REAL ONE, held through Chromium's own input pipeline and released
// the moment the highlight has moved, so exactly one move happens whether a build
// reads the movement action as a press edge or repeats it while held —
// `specs/controls.md` fixes neither for a menu, and this point must not decide it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  watchCues,
  type Harness,
} from "../harness";
import { moveHighlight, soundsOn } from "./cues";

/** Where the highlight rests on arriving at the title (`specs/ui.md`). */
const FIRST_ITEM = 0;

/**
 * Where one move down leaves it, and where a second wraps it back to.
 *
 * `TITLE_ITEMS` carries two items (`specs/ui.md`), so down from the first
 * highlights the second and down from the second wraps round to the first.
 */
const SECOND_ITEM = 1;
const WRAPPED_ITEM = 0;

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

it("sounds on the frame of each move, and on no frame between them", async () => {
  // The harness has already reset the game, so this is the title with its
  // highlight on the first of two items.
  await h.advance(1);
  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the screen the game opens on");
  assertEqual(opened.menuIndex, FIRST_ITEM, "the item the highlight rests on");

  await h.armAudio();
  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const first = await moveHighlight(h);
  const firstFrame = h.frame();
  const firstSounds = soundsOn(played, firstFrame);

  await h.advance(GAP_FRAMES);

  const second = await moveHighlight(h);
  const secondFrame = h.frame();
  const secondSounds = soundsOn(played, secondFrame);

  await captureStill(h, "menu");

  assertEqual(
    first.hit,
    true,
    "the held movement action to move the highlight",
  );
  assertEqual(
    first.snapshot.menuIndex,
    SECOND_ITEM,
    "the item the first move highlights",
  );
  assertEqual(second.hit, true, "the held movement action to move it again");
  assertEqual(
    second.snapshot.menuIndex,
    WRAPPED_ITEM,
    "the item the second move wraps the highlight round to",
  );

  assertGreaterThan(
    firstSounds,
    0,
    `sounds emitted on frame ${firstFrame}, the frame of the first move`,
  );
  assertGreaterThan(
    secondSounds,
    0,
    `sounds emitted on frame ${secondFrame}, the frame of the second move`,
  );
  assertDeepEqual(
    played
      .filter((cue) => cue.frame !== firstFrame && cue.frame !== secondFrame)
      .map((cue) => cue.frame),
    [],
    "the frames of every sound emitted away from the two moves",
  );
});
