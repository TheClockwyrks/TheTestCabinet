// Facet — audio/music-plays: a produced piece of music is playing on the title
// screen, and a further piece starts when the round begins.
//
// specs/assets.md, under Audio: "Produce two pieces: a title theme with a hook,
// and a slower play bed that sits under a round". specs/ui.md, under Audio: "The
// title theme loops on `title` and `howto`, and the play bed loops on `playing`,
// `paused`, and `gameover`. One of the two is playing on every screen." Two
// pieces, and a change of piece at the boundary between them — which is what
// makes "one of the two is playing on every screen" something a check can decide
// rather than merely restate.
//
// WHY THE TITLE SCREEN IS WHERE THE FIRST HALF IS READ. Not one of the eight
// events in specs/ui.md's CUES table can fire there: no cell is selected, no swap
// is made or refused, no chain step clears, no gem reaches MAX_STRAIN, no cut gem
// is created, no level completes and no round ends. So a sound heard on the title
// is music, and nothing else it could be.
//
// HOW THE TWO HALVES ARE READ HERE, AND WHY THEY ARE READ DIFFERENTLY. The
// harness stamps a sound with the frame that produced it, by reading the page's
// audio counters on both sides of each driven frame. A build is entitled to start
// a piece OFF the frame loop — specs/assets.md decodes the produced `.wav`s with
// `decodeAudioData`, which is asynchronous, so a piece asked for on one frame may
// legitimately begin when the decode lands between two frames, and no frame
// produced it. So:
//
//   the title half — read with `warmAudio`, which waits in real time until the
//     build has actually emitted a sound, however that sound was scheduled. On
//     this screen that answers the question exactly: something is sounding, and
//     it can only be music.
//   the round half — read as a further LOOPING start recorded after the round
//     begins. By this point the build has been given its gesture and real time
//     to decode, so the piece the new screen asks for is one it can start at the
//     moment it asks.
//
// WHY THE ROUND IS BEGUN BY A POSE. specs/instrumentation.md gives `start` as the
// pose of choosing `PLAY`, and the piece a screen carries is chosen by the SCREEN
// rather than by the key that reached it — so posing the transition asks the
// question the specification asks, and keeps every cue off the frames the further
// piece is read on. A `confirm` on the title menu would additionally raise
// whatever a build plays for a menu choice.
//
// LOOPING STARTS, NOT SOUNDS IN GENERAL, for the second half. The harness holds
// the two channels apart: a source that loops is a bed, and a one-shot is a cue.
// Reading the looping channel is what keeps a cue from answering a question about
// music, and it is the reading specs/ui.md's own word — "loops" — asks for.

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

afterEach(async () => {
  await h.dispose();
});

/** Drive frames in short rounds, with real time between them, until `sink` fills. */
async function waitForLoop(sink: TimedCue[]): Promise<void> {
  for (let round = 0; round < MUSIC_ROUNDS; round += 1) {
    await h.advance(MUSIC_FRAMES);
    if (sink.length > 0) return;
    await h.settle(MUSIC_POLL_MS);
  }
}

it("plays a piece on the title screen and starts a further one at the round", async () => {
  // The screen the first half is read on, before anything is driven.
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the game opens on",
  );

  // Give the build its gesture and wait, in real time, until it has actually
  // made a sound. On the title screen no cue event exists to make one, so the
  // sound this waits for is a piece of music playing.
  assertEqual(await h.warmAudio(), true, "a sound going out on the title screen");
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the sound was heard on",
  );
  await captureStill(h, "music");

  // From here on, only what starts AFTER the round begins is counted.
  const further = watchLoops(h);
  const round = await startRound(h);
  assertEqual(round.screen, "playing", "the screen the round begins on");

  await waitForLoop(further);
  assertGreaterThan(
    further.length,
    0,
    "looping music started once the round had begun",
  );
});
