// Facet — audio/music-plays: a produced piece of music is playing on the title
// screen, and a further piece starts when the round begins.
//
// specs/assets.md, under Audio: "Produce two pieces: a title theme with a hook,
// and a slower play bed that sits under a round". specs/ui.md, under Audio: "The
// title theme loops on `title` and `howto`, and the play bed loops on `playing`,
// `paused`, `levelclear`, and `gameover`. One of the two is playing on every
// screen." Two pieces, and a change of piece at the boundary between them —
// which is what makes "one of the two is playing on every screen" something a
// check can decide rather than merely restate.
//
// WHY THE TITLE SCREEN IS WHERE THE FIRST HALF IS READ. Not one of the nine
// events in specs/ui.md's CUES table can fire there: no cell is selected, no
// swap is made or refused, no chain step clears or lands, no gem reaches
// MAX_STRAIN, no cut gem is created, no level completes and no round ends. So a
// sound heard on the title is music, and nothing else it could be.
//
// HOW THE TWO HALVES ARE READ HERE, AND WHY THEY ARE READ DIFFERENTLY. The
// harness stamps a sound with the frame that produced it, by reading the page's
// audio counters on both sides of each driven frame, and it holds looping starts
// apart from one-shots — a source that loops is a bed, a one-shot is a cue —
// which is the separation specs/ui.md's own word, "loops", asks for. What it
// cannot do is attribute a start to a frame that did not produce one: a build is
// entitled to start a piece OFF the frame loop, since specs/assets.md decodes the
// produced `.wav`s with `decodeAudioData`, which is asynchronous, so a piece
// asked for on one frame may legitimately begin when the decode lands between two
// frames. So:
//
//   the title half — read with `warmAudio`, which waits in real time until the
//     build has actually emitted a sound, however that sound was scheduled. On
//     this screen that answers the question exactly: something is sounding, and
//     it can only be music.
//   the round half — read as a further LOOPING start recorded after the round
//     begins. By this point the build has been given its gesture and real time to
//     decode, so the piece the new screen asks for is one it can start at the
//     moment it asks.
//
// WHY THE FOUR PLAY SCREENS ARE NOT READ ONE BY ONE. specs/ui.md puts ONE
// boundary between the two pieces, at the round beginning, and gives the play bed
// all four screens on the far side of it. So what decides the sentence is the two
// readings either side of that boundary: a piece playing on `title`, and a
// further piece starting once the round has begun.
//
// AND WHAT THIS ENGINE CANNOT READ AT ALL: A BED STILL RUNNING. An engineless
// build owns its whole audio layer, so nothing outside it announces a bed
// STOPPING — the page can be watched for sounds going out and never for one being
// cut off. A build that carried its bed across a screen change and one that
// simply stopped it look identical from here, so the engine-backed counterparts
// carry a third reading over the pause and this script does not. That is a real
// reduction in what the point proves under this engine, and it is the honest one:
// asserting anything about the pause here would be asserting something the
// harness did not see.
//
// WHY THE ROUND IS BEGUN BY A POSE. The harness's `startRound` is the sequence
// of single-field poses that opens a round, and the piece a screen carries is
// chosen by the SCREEN rather than by the key that reached it — so posing the
// transition asks the question the specification asks, and keeps every cue off
// the frames the further piece is read on. A `confirm` on the title menu would additionally
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

/** Drive frames in short rounds, with real time between them, until `sink` fills. */
async function waitForLoop(sink: TimedCue[]): Promise<void> {
  for (let round = 0; round < MUSIC_ROUNDS; round += 1) {
    await h.advance(MUSIC_FRAMES);
    if (sink.length > 0) return;
    await h.settle(MUSIC_POLL_MS);
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays a piece on the title screen and starts a further one at the round", async () => {
  // The screen the first half is read on, before anything is driven.
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the game opens on",
  );

  // Open the build's audio and wait, in real time, until it has actually made a
  // sound: a build whose first frames are silent while its produced `.wav`s
  // decode is conformant, and reading them would be reading the decoder. On the
  // title screen no cue event exists to make a sound, so what this waits for is a
  // piece of music playing.
  assertEqual(
    await h.warmAudio(),
    true,
    "a sound going out on the title screen",
  );
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
