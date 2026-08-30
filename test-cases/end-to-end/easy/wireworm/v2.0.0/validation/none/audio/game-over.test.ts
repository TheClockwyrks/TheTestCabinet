// audio/game-over — losing the last life sounds a sting on the frame the
// `gameover` screen opens, and the quiet board before it stays silent.
//
// `specs/ui.md`'s cue table: `game-over` is played when "The `gameover` screen
// opens", and every cue "is played on the frame its event happens and at most
// once on that frame". `specs/progression.md` fixes the event: "A contact that
// takes lives to `0` ends the run instead: the game moves to the `gameover`
// screen, reporting `0` lives and the level the run reached."
//
// WHAT IS AND IS NOT OBSERVABLE HERE is set out in `audio/cues`: the sound and
// its frame can be read from outside an engineless build, the cue's NAME cannot.
// That bites a little harder on this point than on most: the frame the run ends
// on is a frame lives also fall on, so a build that plays only its `life` cue and
// no sting sounds exactly like one that plays both. Which sound closed the run is
// the reviewer's, by ear; that the closing frame sounded at all, and that the
// board was silent up to it, is decidable and is what is held here.
//
// THE BOARD IS POSED WITH ONE LIFE, WHICH IS THE DISTINGUISHING VALUE. The
// contact takes lives to exactly `0`, so the run ends on it — posed with the
// three a run opens with, the same contact would have opened a respawn instead
// and this point would have been listening to `audio/life`'s event.
//
// THE CONTACT IS THE ONLY EVENT IN THE WINDOW. `startPlaying` shuts the cursor's
// contact test along with the other two world gates and leaves the board empty;
// the quiet stretch is driven with it still shut, and the segment is laid and the
// gate opened at the last moment.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";
import { contactCursor, framesOtherThan, soundsOn } from "./cues";

/** The lives the board is posed with: the last one, so the contact ends the run. */
const POSED_LIVES = 1;

/** Quiet play driven before the segment is laid in the cursor's box, in frames. */
const QUIET_FRAMES = framesFor(0.3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame the gameover screen opens, and on no other frame", async () => {
  await startPlaying(h);
  await h.debug.setLives(POSED_LIVES);

  await h.armAudio();
  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);

  await contactCursor(h);
  // Read HERE, on the one frame `contactCursor` ran with the gate open.
  const endFrame = h.frame();
  const heard = [...played];
  const after = await h.snapshot();

  await captureStill(h, "gameover");

  assertEqual(
    after.screen,
    "gameover",
    `the screen the contact from ${POSED_LIVES} life left the run on`,
  );
  assertGreaterThan(
    soundsOn(heard, endFrame),
    0,
    `sounds emitted on frame ${endFrame}, the frame the gameover screen opened`,
  );
  assertDeepEqual(
    framesOtherThan(heard, endFrame),
    [],
    "the frames of every sound emitted away from the run ending",
  );
});
