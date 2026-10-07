// audio/life — a contact that costs a life sounds a cue on the frame lives falls,
// and the quiet board before it stays silent.
//
// `specs/ui.md`'s cue table: `life` is played when "A life is lost", and every cue
// "is played on the frame its event happens and at most once on that frame".
// `specs/cursor.md` fixes the event: "A worm segment or a foe reaching the cursor
// costs one life", where "a worm segment reaches the cursor when the segment's
// tile overlaps the cursor's box"; `specs/progression.md` has lives fall by one
// on that contact.
//
// WHAT IS AND IS NOT OBSERVABLE HERE is set out in `audio/cues`: the sound and
// its frame can be read from outside an engineless build, the cue's NAME cannot.
//
// THE BOARD IS POSED WITH LIVES TO SPARE. `START_LIVES` (`3`) is what a run opens
// with, so the contact costs a life and the run goes on — the contact that takes
// lives to `0` opens the `gameover` screen and is `audio/game-over`'s scenario,
// with a second sting on the same frame that must not leak into this one.
//
// THE CONTACT IS THE ONLY EVENT IN THE WINDOW. `startPlaying` shuts the cursor's
// contact test along with the other two world gates and leaves the board empty;
// the quiet stretch is driven with it still shut, so nothing can cost a life
// early, and the segment is laid and the gate opened at the last moment. The
// segment is a worm of one with its step faculty off, so it cannot walk back out
// of the cursor's box between the pose and the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { START_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";
import { contactCursor, framesOtherThan, soundsOn } from "./cues";

/** The lives the board is posed with: a full run, so there are lives to spare. */
const POSED_LIVES = START_LIVES;

/** Quiet play driven before the segment is laid in the cursor's box, in frames. */
const QUIET_FRAMES = framesFor(0.3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame lives falls, and on no other frame", async () => {
  await startPlaying(h);
  await h.debug.setLives(POSED_LIVES);

  await h.armAudio();
  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);

  await contactCursor(h);
  // Read HERE, on the one frame `contactCursor` ran with the gate open.
  const contactFrame = h.frame();
  const heard = [...played];
  const after = await h.snapshot();

  await captureStill(h, "contact");

  assertEqual(
    after.lives,
    POSED_LIVES - 1,
    `the lives left after one contact from ${POSED_LIVES}`,
  );
  assertGreaterThan(
    soundsOn(heard, contactFrame),
    0,
    `sounds emitted on frame ${contactFrame}, the frame lives fell`,
  );
  assertDeepEqual(
    framesOtherThan(heard, contactFrame),
    [],
    "the frames of every sound emitted away from the contact",
  );
});
