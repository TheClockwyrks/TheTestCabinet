// audio/victory — clearing the worm at level 12 sounds a sting on the frame the
// `victory` screen opens, and the quiet board before it stays silent.
//
// `specs/ui.md`'s cue table: `victory` is played when "The `victory` screen
// opens", and every cue "is played on the frame its event happens and at most
// once on that frame". `specs/progression.md` fixes the event: victory is reached
// when "The last worm segment of level `12` is removed", and "the game moves to
// the `victory` screen".
//
// WHAT IS AND IS NOT OBSERVABLE HERE is set out in `audio/cues`: the sound and
// its frame can be read from outside an engineless build, the cue's NAME cannot.
// That bites harder on this point than on most, because the winning frame is also
// a cut and a clear, so it lawfully carries more than one cue and no reading from
// outside can say which of them a build played. `audio/level-clear` reaches past
// presence by counting a cut frame against a clearing frame, and the same trick is
// deliberately NOT used here: `specs/progression.md` writes the level-12 removal
// as its own outcome rather than as a clear plus a win, so whether a build raises
// `level-clear` alongside `victory` at level `12` is a reading the specification
// leaves open, and a count that assumed one reading would fail a build that took
// the other. What is decidable — that the winning frame sounded, and that the
// board was silent up to it — is what is held here; which sound closed the run is
// the reviewer's, by ear.
//
// THE LEVEL IS THE DISTINGUISHING VALUE. `TOTAL_LEVELS` (`12`) is the one level
// on which removing the last segment wins the run rather than advancing it, so a
// build that only ever advances lands on `playing` and is named for it.
//
// The board carries the level's whole worm as one segment and nothing else: a
// worm of one segment is "a head alone" (`specs/worm.md`), which is the shortest
// board on which the removal the rule turns on exists at all. Its step faculty is
// off, so it cannot wind out of the bolt's column while the bolt climbs.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { TOTAL_LEVELS } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  poseWorm,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";
import { framesOtherThan, shootSegment, soundsOn } from "./cues";

/** The tile the level's last segment stands on, clear of the entry row and the band. */
const LAST = { c: 12, r: 8 } as const;

/** Quiet play driven before the bolt is put in flight, in frames. */
const QUIET_FRAMES = framesFor(0.3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame the victory screen opens, and on no other frame", async () => {
  await startPlaying(h, { level: TOTAL_LEVELS });
  await poseWorm(h, { c: LAST.c, r: LAST.r, length: 1, stepping: false });

  await h.armAudio();
  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const won = await shootSegment(h, LAST);
  // Read HERE, on the frame the last segment of level 12 left the board.
  const winFrame = h.frame();
  const heard = [...played];
  const after = await h.snapshot();

  await captureStill(h, "victory");

  assertEqual(won.hit, true, "the bolt to remove the last segment of level 12");
  assertEqual(
    after.screen,
    "victory",
    `the screen the run stands on once the last segment of level ${TOTAL_LEVELS} is gone`,
  );
  assertGreaterThan(
    soundsOn(heard, winFrame),
    0,
    `sounds emitted on frame ${winFrame}, the frame the victory screen opened`,
  );
  assertDeepEqual(
    framesOtherThan(heard, winFrame),
    [],
    "the frames of every sound emitted away from the win",
  );
});
