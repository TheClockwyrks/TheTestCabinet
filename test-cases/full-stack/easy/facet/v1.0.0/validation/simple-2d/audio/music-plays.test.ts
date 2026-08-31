// Facet — audio/music-plays: a produced piece of music is playing on the title
// screen, and a further piece starts when the round begins.
//
// specs/assets.md, under Audio: "Produce two pieces: a title theme with a hook,
// and a slower play bed that sits under a round". specs/ui.md, under Audio: "The
// title theme loops on `title` and `howto`, and the play bed loops on `playing`,
// `paused`, and `gameover`. One of the two is playing on every screen." Two
// pieces, and a change of piece at the boundary between them — which is what
// makes "one of the two is playing on every screen" something a check can
// decide rather than merely restate.
//
// WHY THE TITLE SCREEN IS WHERE THE FIRST HALF IS READ. Not one of the eight
// events in specs/ui.md's CUES table can fire there: no cell is selected, no
// swap is made or refused, no chain step clears, no gem reaches MAX_STRAIN, no
// cut gem is created, no level completes and no round ends. So a sound heard on
// the title is music, and nothing else it could be.
//
// LOOPING STARTS, NOT SOUNDS IN GENERAL. The harness holds the two apart: a
// source that loops is a bed, and a one-shot is a cue. Reading the looping
// channel is what keeps a cue from answering a question about music, and it is
// the reading specs/ui.md's own word — "loops" — asks for.
//
// WHY THE ROUND IS BEGUN BY A POSE. specs/instrumentation.md gives `start` as
// the pose of choosing `PLAY`, and the piece a screen carries is chosen by the
// SCREEN rather than by the key that reached it — so posing the transition asks
// the question the specification asks, and keeps every cue off the frames the
// further piece is read on. A `confirm` on the title menu would additionally
// raise whatever a build plays for a menu choice.
//
// THE WAIT IS REAL TIME AS WELL AS FRAMES. specs/assets.md has the produced
// `.wav`s decoded with the Web Audio API, which is asynchronous, so a build is
// entitled to reach for the play bed on the frame the screen changes and start
// it once the decode lands. The poll below drives frames and lets real time
// pass between them, and gives up rather than hanging.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startRound,
  watchLoops,
  type Harness,
  type TimedCue,
} from "../harness";

/**
 * How the further piece is waited for: rounds of frames, and the real time each
 * round allows a decode.
 *
 * NOT specification figures. specs/assets.md fixes only that a produced sound is
 * decoded asynchronously, never how long that takes, so these are the suite's own
 * patience — long enough that a decode kicked off by the screen change lands, and
 * bounded so a build that never starts a second piece fails instead of hanging.
 */
const MUSIC_ROUNDS = 20;
const MUSIC_FRAMES = 4;
const MUSIC_POLL_MS = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Drive frames in short rounds, with real time between them, until `sink` fills. */
async function waitForLoop(sink: TimedCue[]): Promise<void> {
  for (let round = 0; round < MUSIC_ROUNDS; round += 1) {
    await h.advance(MUSIC_FRAMES);
    if (sink.length > 0) return;
    await h.settle(MUSIC_POLL_MS);
  }
}

it("loops a piece on the title screen and starts a further one at the round", async () => {
  // The screen the first half is read on, before anything is driven.
  assertEqual(h.snapshot().screen, "title", "the screen the game opens on");

  // Open the build's audio and wait, in real time, until it has actually made a
  // sound: a build whose first frames are silent while its produced `.wav`s
  // decode is conformant, and reading them would be reading the decoder.
  assertEqual(await h.warmAudio(), true, "the build ever made a sound");
  assertEqual(h.snapshot().screen, "title", "the screen the sound was heard on");
  captureStill(h, "music");

  // A looping source is playing, and on this screen music is the only thing it
  // can be.
  assertGreaterThan(
    h.loops.length,
    0,
    "looping music started while the title screen stood",
  );

  // From here on, only what starts AFTER the round begins is counted.
  const further = watchLoops(h);
  const round = startRound(h);
  assertEqual(round.screen, "playing", "the screen the round begins on");

  await waitForLoop(further);
  assertGreaterThan(
    further.length,
    0,
    "looping music started once the round had begun",
  );
});
