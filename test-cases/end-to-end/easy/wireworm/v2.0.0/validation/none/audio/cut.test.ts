// audio/cut — a bolt destroying a worm segment sounds a cue on the frame the
// segment is removed, and the flight before it stays silent.
//
// `specs/ui.md`'s cue table: `cut` is played when "A bolt destroys a worm
// segment", and every cue "is played on the frame its event happens and at most
// once on that frame". `specs/worm.md` fixes the event: "A bolt travelling up a
// column destroys the first worm segment in its path", and `specs/cursor.md` has
// the bolt resolve "against the first thing its center reaches".
//
// WHAT IS AND IS NOT OBSERVABLE HERE is set out in `audio/cues`: the sound and
// its frame can be read from outside an engineless build, the cue's NAME cannot.
//
// THE WORM CARRIES THREE SEGMENTS, AND THAT IS THE POINT OF THE NUMBER. A worm
// of one is the LAST of a level's segments, and removing it clears the level
// (`specs/progression.md`), which raises a second cue on the very same frame —
// that is `audio/level-clear`'s scenario and it must not leak into this one. A
// worm of three leaves two standing, so the frame read here carries the cut and
// nothing else.
//
// THE WORM'S `stepping` IS HELD OFF. A worm that stepped while the bolt climbed
// would be on another tile by the time it arrived, and this point would be
// deciding the step clock (`worm/step-cadence`) as much as the cue. Its body gate
// is left alone: the chain's shape is no part of this.
//
// WHAT THE CUT LEAVES BEHIND IS NOT READ. `specs/nodes.md` lays a fresh node on
// the tile a shot segment died on; that is `nodes/shot-leaves-node`'s
// requirement, and no cue of the ten answers to it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseWorm,
  segmentTiles,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";
import { framesOtherThan, shootSegment, soundsOn } from "./cues";

/** The worm posed: three segments, head at (12, 8), trailing to column 10. */
const LENGTH = 3;
const HEAD = { c: 12, r: 8 } as const;

/** What the cut leaves standing, so the frame read here clears no level. */
const AFTER_CUT = LENGTH - 1;

/** Quiet play driven before the bolt is put in flight, in frames. */
const QUIET_FRAMES = framesFor(0.3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame the segment is removed, and on no other frame", async () => {
  await startPlaying(h);
  await poseWorm(h, {
    c: HEAD.c,
    r: HEAD.r,
    length: LENGTH,
    stepping: false,
  });

  await h.armAudio();
  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const cut = await shootSegment(h, HEAD);
  // Read HERE, on the frame the segment left the board.
  const cutFrame = h.frame();
  const heard = [...played];

  await captureStill(h, "cut");

  assertEqual(cut.hit, true, "the bolt to destroy a worm segment");
  assertLength(
    segmentTiles(cut.snapshot),
    AFTER_CUT,
    "the segments still standing, so the level did not clear on this frame",
  );
  assertGreaterThan(
    soundsOn(heard, cutFrame),
    0,
    `sounds emitted on frame ${cutFrame}, the frame the segment was removed`,
  );
  assertDeepEqual(
    framesOtherThan(heard, cutFrame),
    [],
    "the frames of every sound emitted away from the cut",
  );
});
