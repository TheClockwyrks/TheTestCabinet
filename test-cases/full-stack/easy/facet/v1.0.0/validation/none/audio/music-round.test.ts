// Facet — audio/music-round: a further piece of music starts when the round
// begins.
//
// specs/assets.md, under Audio: "Produce two pieces: a title theme with a hook,
// and a slower play bed that sits under a round". specs/ui.md, under Audio: "The
// title theme loops on `title` and `howto`, and the play bed loops on `playing`,
// `paused`, `levelclear`, and `gameover`. One of the two is playing on every
// screen." Two pieces, and a change of piece at the boundary between them —
// which is what makes "one of the two is playing on every screen" something a
// check can decide rather than merely restate.
//
// THE PIECE THE TITLE CARRIES IS ITS OWN POINT. `audio/music-title` reads the
// near side of that boundary: a build that ships a title theme and no play bed
// passes there and fails here, and one that ships neither owes both.
//
// HOW IT IS READ. As a further LOOPING start recorded after the round begins.
// The harness stamps a sound with the frame that produced it, by reading the
// page's audio counters on both sides of each driven frame, and it holds looping
// starts apart from one-shots — a source that loops is a bed, a one-shot is a
// cue — which is the separation specs/ui.md's own word, "loops", asks for.
//
// WHY THE BUILD IS WARMED FIRST. A page makes no sound until it has had a
// gesture, and specs/assets.md decodes the produced `.wav`s asynchronously, so
// the build is given both before the boundary is crossed. A build that emits no
// sound at all fails here, which is the honest verdict: the piece this point is
// about is one of the sounds it never made.
//
// WHY THE FOUR PLAY SCREENS ARE NOT READ ONE BY ONE. specs/ui.md puts ONE
// boundary between the two pieces, at the round beginning, and gives the play bed
// all four screens on the far side of it. So what decides the sentence is the
// reading taken once the round has begun.
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
// the frames the further piece is read on. A `confirm` on the title menu would
// additionally raise whatever a build plays for a menu choice.
//
// THE WAIT IS COUNTED IN FRAMES. The rounds below drive frames, each a crossing
// into the page that lets a decode land between one frame and the next, and
// give up after a counted number of rounds rather than hanging or measuring the
// host.

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
 * How the further piece is waited for: rounds of frames.
 *
 * NOT specification figures. specs/assets.md fixes only that a produced sound is
 * decoded asynchronously, never how many frames that takes, so these are the
 * suite's own patience — a failure cap counted in frames rather than measured in
 * real time, and bounded so a build that never starts a second piece fails
 * instead of hanging.
 */
const MUSIC_ROUNDS = 20;
const MUSIC_FRAMES = 4;

let h: Harness;

/** Drive frames in short rounds until `sink` fills, or the rounds run out. */
async function waitForLoop(sink: TimedCue[]): Promise<void> {
  for (let round = 0; round < MUSIC_ROUNDS; round += 1) {
    await h.advance(MUSIC_FRAMES);
    if (sink.length > 0) return;
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts a further piece once the round has begun", async () => {
  // The screen the first half is read on, before anything is driven.
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the game opens on",
  );

  // Open the build's audio and drive frames until it has actually made a sound.
  // This is the ROUTE, not the point — that the title carries a piece is
  // `audio/music-title`'s — and it is what gives the build its gesture and the
  // frames to decode over before the boundary is crossed.
  assertEqual(
    await h.warmAudio(),
    true,
    "a sound going out on the title screen",
  );
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the round is begun from",
  );

  // From here on, only what starts AFTER the round begins is counted.
  const further = watchLoops(h);
  const round = await startRound(h);
  assertEqual(round.screen, "playing", "the screen the round begins on");

  await waitForLoop(further);
  await captureStill(h, "music");
  assertGreaterThan(
    further.length,
    0,
    "looping music started once the round had begun",
  );
});
