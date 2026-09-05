// assets/assets-decoded-before-first-frame — the game starts ready.
//
// THE RULE, from Where the files land of `specs/assets.md`: "Every image is
// decoded and every sound is bound to its cue before the first frame draws",
// which under an engine is spelled as the same requirement over the engine's own
// loader — "Each image is loaded with `api.assets.loadImage` and each audio cue
// below is bound to its produced file with `api.audio.load` under its name in
// `CUES`, awaited in `initialize`, so every asset is decoded before the first
// frame."
//
// WHY IT IS ASKED. A build that decodes lazily shows a player a first screen with
// its pictures missing and fills them in over the following frames, and plays a
// cue's event in silence until that cue's file happens to arrive. The
// specification puts the whole load in front of the first frame so the game a
// player sees is never a game still assembling itself.
//
// WHAT IT READS, in three readings of one untouched run.
//
//   1. THE FIRST FRAME ALREADY DRAWS PRODUCED IMAGES. The opening frame is
//      driven, and the distinct sources it drew are counted: a build still
//      decoding draws none of them.
//   2. AND NOTHING ARRIVES AFTER IT. The same screen is drawn again many frames
//      later, and the sources it draws are the SAME sources — the same drawn
//      handles, in the same number. A build whose decode resolved during those
//      frames draws a source on the later frame that the first frame did not have.
//   3. AND NO PRODUCED FILE FAILED TO ARRIVE. The harness's ledger of produced
//      files the build asked for and did not get is empty, and by the opening
//      frames the build is emitting sound — a cue bound to its file, which on the
//      title screen, where nothing a player did can sound, is the bed
//      `specs/ui.md` keeps "looping on every frame the game runs".
//
// WHY THE TITLE SCREEN. It is where the game opens — the first frame it draws is
// a frame of it — and no scenario has to be posed to reach it, so the frame this
// point reads is the first frame the build ever drew rather than one some
// arrangement drove it to.
//
// WHAT THIS POINT DOES NOT DECIDE. What each produced file is, and whether it
// decodes, are the sprite, system and sound points. This one decides that nothing
// is still loading when the game starts.
//
// THE EVIDENCE is the first frame itself, as the build drew it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  distinctSources,
  type Harness,
} from "../harness";

/** How many frames pass between the two readings of the same screen. */
const SETTLE_FRAMES = 45;

/**
 * How many frames a cue is given to be heard on, once audio is armed.
 *
 * A build that plays a produced sound decodes it asynchronously, so the bed
 * starts on whichever frame its file finished decoding on — a property of the
 * host rather than of the build. The sweep below is bounded rather than timed,
 * and the bound is a few seconds of game time: generous against a build that
 * decodes five megabytes of music, and finite against one that plays nothing.
 */
const CUE_BOUND = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("has every produced asset ready before the first frame draws", async () => {
  const opening = distinctSources(await h.frameCalls());
  await captureStill(h, "first-frame");

  assertGreaterThan(
    opening.length,
    0,
    "distinct produced images the opening frame drew: a build still decoding draws none",
  );

  await h.advance(SETTLE_FRAMES);
  const settled = distinctSources(await h.frameCalls());
  assertDeepEqual(
    settled.map((source) => source.id).sort((a, b) => a - b),
    opening.map((source) => source.id).sort((a, b) => a - b),
    `the sources the same screen draws ${SETTLE_FRAMES} frames later, which are the ones the first frame already had`,
  );

  await h.armAudio();
  for (
    let frame = 0;
    frame < CUE_BOUND && (await h.sounds()) === 0;
    frame += 1
  ) {
    await h.advance(1);
  }
  assertGreaterThan(
    await h.sounds(),
    0,
    "sounds emitted by the opening frames: a cue bound to its file, which on the title screen is the bed",
  );

  assertLength(
    h.assetFailures,
    0,
    `produced files the build asked for and did not get: ${JSON.stringify(h.assetFailures)}`,
  );
});
