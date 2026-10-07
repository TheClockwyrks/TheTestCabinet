// assets/bed-plays-its-own-file — the bed the game runs is the produced `.wav`.
//
// THE RULE, from The music bed of `specs/assets.md`: "Produce the `music` cue
// with `music` ... `assets/audio/music.wav`, with its `assets/audio/music.mid`
// committed beside it. THE `.WAV` IS WHAT THE GAME PLAYS, for as long as
// `specs/ui.md` states". The two files are not interchangeable: the `.mid` is the
// score the bed was sequenced from, a document of notes with no sound in it that
// no browser plays, and it is committed as the record of the sequence. The `.wav`
// is the rendered music.
//
// THE POINT IS DECIDED IN TWO HALVES.
//
//   1. THE BED RUNS. On the title screen, with nothing pressed and nothing
//      placed, the build is heard emitting sound — which is `specs/ui.md`'s
//      "`music` is looping on every frame the game runs, on `title`, `howto`,
//      `select`, and `editor` alike". Nothing a player did can sound there, so a
//      sound on that screen is the bed.
//
//   2. AND WHAT IT RUNS IS THE `.WAV`. The produced files the same run asked for
//      are read back: they name the `.wav` and do not name the `.mid`. A build
//      that synthesized its bed asks for neither; a build that tried to play the
//      score asks for it.
//
// WHY THE REQUESTS ARE THE READING RATHER THAN THE SOUND. Every produced file is
// served here, exactly as it is to every other check, so what the bed SOUNDS LIKE
// is never compared against a file — that is the reviewer's. What the run can
// honestly see is what the build REACHED FOR.
//
// WHAT THIS POINT DOES NOT DECIDE. That the bed keeps looping across screens,
// across a paused, faulted or complete run, and through a level change is the
// audio category's, one point apiece; that the file is thirty seconds long and
// loops without a seam is decided here in `assets/` by its own two points. This
// one decides that the bed the game runs is the produced file rather than a
// synthesized drone, and that it is the `.wav` rather than the score beside it.
//
// THE EVIDENCE is the game running its bed on the title screen: the frames drawn
// while the sound the verdict counted was emitted.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { captureReplay, createHarness, type Harness } from "../harness";
import { BED_FILE, SCORE_FILE } from "./files";

/**
 * How many frames the bed is given to start on.
 *
 * A build that plays a produced bed decodes it asynchronously, so the bed starts
 * on whichever frame its file finished decoding on — a property of the host
 * rather than of the build. The sweep below is bounded rather than timed, and the
 * bound is a few seconds of game time: generous against a build that decodes five
 * megabytes of music, and finite against one that never plays anything.
 */
const BED_BOUND = 300;

/** How many frames the recording holds of the game running its bed. */
const BED_FRAMES = 8;

/**
 * The produced bed and its score, as a request for either looks.
 *
 * A built site is a BUNDLE, so `assets/audio/music.wav` is served under whatever
 * name the bundler emitted it as — `music-jZf3hdwr.wav` — while an engine's
 * loader is handed the authored path itself. What survives both is the stem and
 * the extension, which is what these match.
 */
const BED_REQUEST = /(^|\/)music([-.][^/]*)?\.wav$/;
const SCORE_REQUEST = /(^|\/)music([-.][^/]*)?\.mid$/;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs the bed from assets/audio/music.wav rather than from its score", async () => {
  const sounded = await captureReplay(h, "bed", async () => {
    await h.armAudio();
    // A few frames unconditionally, so the recording holds the game running its
    // bed whether the bed was already sounding when the window opened or not,
    // and then as many more as the decode needs.
    await h.advance(BED_FRAMES);
    for (
      let frame = 0;
      frame < BED_BOUND && (await h.sounds()) === 0;
      frame += 1
    ) {
      await h.advance(1);
    }
    return {
      screen: (await h.snapshot()).screen,
      heard: await h.sounds(),
    };
  });

  assertEqual(
    sounded.screen,
    "title",
    "the game opens on the title screen, where nothing a player did can sound",
  );
  assertGreaterThan(
    sounded.heard,
    0,
    `sounds the build has emitted within ${BED_BOUND} frames of the game opening, which on the title screen is the bed`,
  );

  // And what it runs is the `.wav`: the files this run asked for name the bed and
  // do not name the score beside it.
  const asked = await h.assetRequests();
  assertNotNull(
    asked.find((path) => BED_REQUEST.test(path)) ?? null,
    `a request for the produced bed, ${BED_FILE}, among ${JSON.stringify(asked)}`,
  );
  assertEqual(
    asked.filter((path) => SCORE_REQUEST.test(path)).length,
    0,
    `requests for the committed score, ${SCORE_FILE}, which is not what the game plays`,
  );
});
