// audio/level-clear — the frame a level clears carries the level-clear cue on top
// of the cut that cleared it.
//
// `specs/ui.md`'s cue table: `level-clear` is played when "A level clears".
// `specs/progression.md` fixes the event: "A level clears on the step in which
// the last of its worm segments is removed."
//
// WHY PRESENCE ALONE CANNOT DECIDE THIS POINT. The removal that clears a level is
// itself a bolt destroying a worm segment, so its frame lawfully carries TWO
// cues: `specs/ui.md`, "a frame that raises more than one of them plays each of
// those once." A cue's NAME is unobservable from outside an engineless build
// (`audio/cues`), so "the clearing frame sounded" is equally true of a build that
// plays its cut cue and no clear cue at all.
//
// WHAT CAN DECIDE IT: COUNTING. `specs/ui.md` has the build "[d]efine and play
// exactly the ten cues below, under exactly these names, one per event", so a
// given cue is one defined sound and emits the same way every time it plays.
// A frame that plays cut AND level-clear therefore emits strictly more sound than
// a frame that plays cut alone. This point drives both frames — a plain cut, then
// the clearing cut — and holds the clearing frame's emission strictly above the
// plain one's. That is an ordering, not a threshold: no number of sources per cue
// is assumed, and a build whose every cue is a three-oscillator chord passes it
// exactly as one whose cues are single tones does.
//
// THE TWO BOARDS DIFFER IN ONE THING ONLY. Same level, same tile, same bolt from
// the same tile beneath it; the first carries a worm of two segments and the
// second a worm of one, so the first removal leaves a segment standing and the
// second removes the level's last. The board is re-posed between them rather than
// played on, so the node the first cut left behind and the segment it spared are
// both gone and the second shot climbs the same empty column the first did.
//
// The level is `4`: below `TOTAL_LEVELS` (`12`), so the clear advances the run
// rather than winning it — the level-12 clear is `audio/victory`'s scenario and
// carries a third cue.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
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

/** The level both cuts are driven at: below TOTAL_LEVELS, so a clear advances. */
const LEVEL = 4;

/** The tile shot on both boards, clear of the entry row and the player band. */
const TARGET = { c: 12, r: 8 } as const;

/** The worm the plain cut is taken out of: two segments, so one survives it. */
const PLAIN_LENGTH = 2;

/** The worm the clearing cut is taken out of: the level's last segment. */
const LAST_LENGTH = 1;

/** Quiet play driven before each bolt is put in flight, in frames. */
const QUIET_FRAMES = framesFor(0.3);

/** Quiet play driven between the two cuts, so neither sound can be read as the other's. */
const GAP_FRAMES = framesFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds more on the clearing cut than on a plain cut of the same board", async () => {
  await startPlaying(h, { level: LEVEL });
  await h.armAudio();

  // Watched after the board is posed, so what is read is the two drives alone.
  const played = watchCues(h);

  // The plain cut: a segment goes and the level stands.
  await poseWorm(h, {
    c: TARGET.c,
    r: TARGET.r,
    length: PLAIN_LENGTH,
    stepping: false,
  });
  await h.advance(QUIET_FRAMES);
  const plain = await shootSegment(h, TARGET);
  const plainFrame = h.frame();
  const plainSounds = soundsOn(played, plainFrame);

  await h.advance(GAP_FRAMES);

  // The clearing cut: the same shot on the same tile, with the level's last
  // segment on it.
  await startPlaying(h, { level: LEVEL });
  await poseWorm(h, {
    c: TARGET.c,
    r: TARGET.r,
    length: LAST_LENGTH,
    stepping: false,
  });
  await h.advance(QUIET_FRAMES);
  const clearing = await shootSegment(h, TARGET);
  const clearFrame = h.frame();
  const clearSounds = soundsOn(played, clearFrame);
  const cleared = await h.snapshot();

  await captureStill(h, "clear");

  assertEqual(plain.hit, true, "the first bolt to destroy a worm segment");
  assertEqual(
    segmentTiles(plain.snapshot).length,
    PLAIN_LENGTH - 1,
    "the segments still standing after the plain cut, so the level stood",
  );
  assertEqual(clearing.hit, true, "the second bolt to destroy a worm segment");
  assertEqual(
    cleared.level,
    LEVEL + 1,
    `the level the run stands at once the last segment of level ${LEVEL} is gone`,
  );

  assertDeepEqual(
    [
      ...framesOtherThan(
        played.filter((cue) => cue.frame !== clearFrame),
        plainFrame,
      ),
    ],
    [],
    "the frames of every sound emitted away from the two cuts",
  );
  assertGreaterThan(
    plainSounds,
    0,
    `sounds emitted on frame ${plainFrame}, the plain cut`,
  );
  assertGreaterThan(
    clearSounds,
    plainSounds,
    `the sound on the clearing frame ${clearFrame}, which carries the ` +
      `level-clear cue on top of its cut (the plain cut emitted ${plainSounds})`,
  );
});
