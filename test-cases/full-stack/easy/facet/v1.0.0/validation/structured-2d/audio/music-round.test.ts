// Facet — audio/music-round: the play bed sits under a round, and stays under it
// across a screen change.
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
// TWO READINGS, ONE REQUIREMENT. A bed "that sits under a round" is asked the
// only two questions that sentence can be asked: that it starts once the round
// has begun, and that it is still there once the round changes screen. Neither
// alone says the bed sits under the round, so both are read here.
//
// WHY THE FOUR PLAY SCREENS ARE NOT READ ONE BY ONE. specs/ui.md puts ONE
// boundary between the two pieces, at the round beginning, and gives the play bed
// all four screens on the far side of it. `paused` is the screen change taken
// here, because it is the one a player reaches mid-round most often and the one
// the board is still standing behind.
//
// HOW "STILL RUNNING" IS READ. The engine's bus announces a bed starting and a
// bed stopping, so what is tracked is the SET of beds currently looping: a start
// adds a name, a stop takes it away. A build that carries its bed straight across
// the pause leaves the set as it was; one that stops it and starts it again on the
// new screen leaves the same name in the set; one that simply stops it leaves the
// set without it, and fails.
//
// WHY THE BUILD IS WARMED FIRST. A page makes no sound until it has had a
// gesture, and specs/assets.md decodes the produced `.wav`s asynchronously, so
// the build is given both before the boundary is crossed. A build that emits no
// sound at all fails here, which is the honest verdict: the piece this point is
// about is one of the sounds it never made.
//
// WHY THE ROUND IS BEGUN BY A POSE. The harness's `startRound` is the sequence
// of single-field poses that opens a round, and the piece a screen carries is
// chosen by the SCREEN rather than by the key that reached it — so posing the
// transition asks the question the specification asks, and keeps every cue off
// the frames the further piece is read on. A `confirm` on the title menu would
// additionally raise whatever a build plays for a menu choice.
//
// THE WAIT IS REAL TIME AS WELL AS FRAMES. specs/assets.md has the produced
// `.wav`s decoded with the Web Audio API, which is asynchronous, so a build is
// entitled to reach for the play bed on the frame the screen changes and start
// it once the decode lands. The poll below drives frames and lets real time
// pass between them, and gives up rather than hanging.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  pauseGame,
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

/**
 * Rounds driven after the pause, so a build that answers a screen change on the
 * frame after it has answered before the set is read.
 *
 * NOT a specification figure, and short on purpose: nothing has to START here, so
 * this is only the room a build needs to do whatever it does about the change.
 */
const PAUSE_ROUNDS = 4;

let h: Harness;

/**
 * The names of the beds currently looping, kept live off the engine's bus.
 *
 * A start adds a name and a stop takes it away, so the set is what is playing
 * rather than what has ever played — which is the only way "still running" can be
 * asked of a screen the game has moved on to.
 */
function watchRunningLoops(): Set<string> {
  const running = new Set<string>();
  h.engine.events.on("cue:looped", ({ cue }) => running.add(cue));
  h.engine.events.on("cue:stopped", ({ cue }) => running.delete(cue));
  return running;
}

/** Drive frames in short rounds, with real time between them, until `sink` fills. */
async function waitForLoop(sink: TimedCue[]): Promise<void> {
  for (let round = 0; round < MUSIC_ROUNDS; round += 1) {
    await h.advance(MUSIC_FRAMES);
    if (sink.length > 0) return;
    await h.settle(MUSIC_POLL_MS);
  }
}

/** Drive a short stretch of frames, with real time between them, waiting on nothing. */
async function letTheScreenSettle(): Promise<void> {
  for (let round = 0; round < PAUSE_ROUNDS; round += 1) {
    await h.advance(MUSIC_FRAMES);
    await h.settle(MUSIC_POLL_MS);
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("starts the play bed at the round and keeps it under a pause", async () => {
  // The screen the first half is read on, before anything is driven.
  assertEqual(h.snapshot().screen, "title", "the screen the game opens on");
  const running = watchRunningLoops();

  // Open the build's audio and wait, in real time, until it has actually made a
  // sound. This is the ROUTE, not the point — that the title carries a piece is
  // `audio/music-title`'s — and it is what gives the build its gesture and real
  // time to decode before the boundary is crossed.
  assertEqual(await h.warmAudio(), true, "the build ever made a sound");
  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen the round is begun from",
  );

  // From here on, only what starts AFTER the round begins is counted.
  const further = watchLoops(h);
  const round = startRound(h);
  assertEqual(round.screen, "playing", "the screen the round begins on");

  await waitForLoop(further);
  captureStill(h, "music");
  assertGreaterThan(
    further.length,
    0,
    "looping music started once the round had begun",
  );

  // The bed a round is played under, named while the round is being played.
  const underPlay = [...running];
  assertGreaterThan(underPlay.length, 0, "beds looping while the round runs");

  // And it is still running once the round is held: specs/ui.md gives the play
  // bed `paused` as well as `playing`.
  pauseGame(h);
  assertEqual(
    h.snapshot().screen,
    "paused",
    "the screen the pause poses reach",
  );
  await letTheScreenSettle();

  assertTrue(
    underPlay.some((bed) => running.has(bed)),
    `a bed that was looping under the round still looping once it was paused, ` +
      `of ${JSON.stringify(underPlay)}, against ${JSON.stringify([...running])}`,
  );
});
