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
//   2. AND WHAT IT RUNS IS THE `.WAV`. A second run of the game has BOTH the bed
//      and its score withheld, and the ledger of produced files the build asked
//      for and did not get names the `.wav` and does not name the `.mid`. A build
//      that synthesized its bed asks for neither; a build that tried to play the
//      score asks for it.
//
// WHY THE WITHHELD RUN IS READ FOR ITS REQUESTS RATHER THAN FOR ITS SILENCE.
// `specs/assets.md` requires that "A load that fails leaves the game running", and
// a build is free to meet that by falling back to something it synthesizes — so a
// bed that still sounds with its file withheld is conformant, and silence is not
// a reading a check may demand. What the withheld run can honestly see is what
// the build REACHED FOR.
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

/** How many frames the withheld run is given to ask for its files in. */
const LOAD_FRAMES = 3;

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
  // ARMED AT CREATION, because the first half of this point is that the bed RUNS:
  // a browser opens no audio context without a user gesture, so an unarmed page is
  // silent whatever the build produced, and the reading would be the host's rather
  // than the build's. The press of `INERT_KEY` goes in before the harness's opening
  // `reset`, whose restore puts back anything it touched, so the title screen the
  // recording below opens on is the one an unarmed harness would have handed over.
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("runs the bed from assets/audio/music.wav rather than from its score", async () => {
  const sounded = await captureReplay(h, "bed", async () => {
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

  // Unarmed, deliberately: this half reads what the build REACHED FOR and never
  // listens, so it is handed no gesture.
  const withheld = await createHarness({
    withoutAssets: new RegExp(`${BED_REQUEST.source}|${SCORE_REQUEST.source}`),
  });
  try {
    await withheld.advance(LOAD_FRAMES);
    const asked = withheld.assetFailures.map((failure) => failure.path);
    assertNotNull(
      asked.find((path) => BED_REQUEST.test(path)) ?? null,
      `a request for the produced bed, ${BED_FILE}, among ${JSON.stringify(asked)}`,
    );
    assertEqual(
      asked.filter((path) => SCORE_REQUEST.test(path)).length,
      0,
      `requests for the committed score, ${SCORE_FILE}, which is not what the game plays`,
    );
  } finally {
    await withheld.dispose();
  }
});
