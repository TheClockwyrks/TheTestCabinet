// Spectra — screens/intro-gives-way: the stage intro holds, then opens the wave.
//
// THE RULE. `specs/ui.md`, on `stageIntro`: "It lasts `STAGE_INTRO_HOLD` (`2.0`)
// seconds and then opens the live wave." So there are two things to read and they
// are one requirement: how long the screen stood, and what it opened onto.
//
// THE HOLD IS THE BUILD'S OWN, WHICH IS WHY THE RUN IS OPENED FROM THE TITLE.
// `setPhaseTimer` would put the case's figure into the build's own clock, and a
// build whose intro holds for three seconds would then give way at two — the check
// would be measuring the number it posed. So the intro is reached the way a player
// reaches it: from a reset title, with the highlight on the mode entry, by a real
// `confirm`. `specs/ui.md` says that opens `stageIntro`, and whatever hold the
// build then set is what is measured.
//
// THE MEASUREMENT. Frames of the harness's own `100 Hz` clock, run one at a time
// from the frame the screen opened until the screen changes, converted to seconds.
// The frame the key was delivered on is the frame the screen opened; whether a
// build decrements its hold on that same frame is its own business, and the one
// frame either way is `0.01` seconds against a `0.4`-second tolerance.
//
// THE TOLERANCE. `20%` of `STAGE_INTRO_HOLD`, which is the figure the review item
// states. It is wide because the specification fixes the hold and leaves how a
// build counts it down entirely open — from a timer decremented by the frame's
// delta, from an accumulated clock, from a frame count — and none of those lands
// on the same frame.
//
// THE THREE GATES ARE LEFT AS THE SPECIFICATION LEAVES THEM: ON. The wave the
// intro opens onto is the game's own, built in the moment the hold gives way
// (`specs/stages.md`), and this point is about that moment. Nothing on the field is
// posed or read.
//
// WHAT IS NOT ASSERTED. What the intro DRAWS is `screens/stage-intro-names-stage`'s
// and `screens/challenge-banner`'s; what the opened wave HOLDS is the `stages`
// group's; that confirming the mode entry opens the intro at all is
// `screens/start-enters-stage-intro`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertTrue } from "../assert";
import { STAGE_INTRO_HOLD } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  seconds,
  startRunFromTitle,
  type Harness,
} from "../harness";

/**
 * How far the measured hold may fall from `STAGE_INTRO_HOLD`, as a fraction.
 *
 * The `20%` the review item states. `specs/ui.md` fixes the hold at `2.0` seconds
 * and says nothing about how it is counted down, so the band has to cover a build
 * that runs its timer off the frame's delta, one that runs it off an accumulated
 * clock, and one that counts whole frames.
 */
const HOLD_TOLERANCE = 0.2;

/**
 * The most frames the sweep may run before giving up.
 *
 * Twice the hold, which is well past the top of the tolerance band and is a bound
 * on the scenario rather than a threshold on the build: a build whose intro never
 * gives way fails on the band below, naming the hold it ran instead.
 */
const MAX_FRAMES = framesFor(STAGE_INTRO_HOLD * 2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the stage intro for STAGE_INTRO_HOLD and then opens the live wave", async () => {
  // Opened the way a player opens it, so the hold that runs is the build's.
  await startRunFromTitle(h);
  assertEqual(
    (await h.snapshot()).screen,
    "stageIntro",
    "confirming the mode entry opened the stage intro (specs/ui.md)",
  );

  const swept = await h.until((s) => s.screen !== "stageIntro", {
    maxFrames: MAX_FRAMES,
    poll: 1,
  });
  await captureStill(h, "wave");

  const held = seconds(swept.frames);
  assertTrue(
    swept.hit,
    `the stage intro giving way inside ${seconds(MAX_FRAMES)} seconds — it ` +
      `lasts STAGE_INTRO_HOLD (${STAGE_INTRO_HOLD}) seconds and then opens the ` +
      "live wave (specs/ui.md)",
  );
  assertBetween(
    held,
    STAGE_INTRO_HOLD * (1 - HOLD_TOLERANCE),
    STAGE_INTRO_HOLD * (1 + HOLD_TOLERANCE),
    `the seconds the stage intro stood — STAGE_INTRO_HOLD is ` +
      `${STAGE_INTRO_HOLD} seconds (specs/ui.md), within ` +
      `${HOLD_TOLERANCE * 100}%`,
  );
  assertEqual(
    swept.snapshot.screen,
    "inWave",
    "the screen the hold gave way to — the stage intro opens the LIVE WAVE " +
      "(specs/ui.md)",
  );
});
