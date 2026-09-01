// Spectra — screens/stage-cleared-hold: the interstitial holds, then opens the next
// stage's intro.
//
// THE RULE. `specs/ui.md`, on `stageCleared`: "The interstitial a finished stage
// opens. It lasts `STAGE_CLEARED_HOLD` (`2.6`) seconds and then opens the next stage's
// intro, with the stage number one higher." So there are two things to read and they
// are one requirement: how long the screen stood, and what it opened onto.
//
// THE HOLD IS THE BUILD'S OWN, WHICH IS WHY A STAGE IS REALLY FINISHED.
// `setPhaseTimer` would put the case's figure into the build's own clock, and a build
// whose interstitial holds for four seconds would then give way at `2.6` — the check
// would be measuring the number it posed. So the screen is reached the way the game
// reaches it: by a stage ending.
//
// THE STAGE IS A CHALLENGE STAGE, and that is the whole reason this check is cheap.
// `specs/stages.md` makes every `CHALLENGE_EVERY`-th stage a non-firing flyover whose
// groups "sweep across the play field ... and leave it within eight seconds of the
// group's release", and "the stage ends in the moment the last of its drones has left
// the field or been destroyed". So a challenge stage FINISHES ON ITS OWN, with nothing
// shot and no player implemented — the game replays to a known outcome — where a
// standard stage clears only when its last drone is destroyed, and a settled formation
// is out of a discharge's reach (`specs/resonance.md`). Nothing on the field is posed
// or touched: the wave the game built is what plays out.
//
// AND NOTHING CAN COST A LIFE WHILE IT PLAYS. `specs/stages.md`: on a challenge stage
// "no drone fires", "no enemy bullet appears anywhere", and "a challenge drone's body
// costs no life". So the run cannot enter the `ready` phase or end underneath the
// reading, and the ship is left exactly where a new run puts it.
//
// THE MEASUREMENT. Both sweeps run a frame at a time on the harness's own `120 Hz`
// clock, so the frame the interstitial opened on is exact and the hold is counted from
// it rather than from a coarse sample that had already overshot.
//
// THE TOLERANCE. `20%` of `STAGE_CLEARED_HOLD`, which is the figure the review item
// states. It is wide because the specification fixes the hold and leaves how a build
// counts it down entirely open — from a timer decremented by the frame's delta, from
// an accumulated clock, from a frame count — and none of those lands on the same frame.
//
// WHAT IS NOT ASSERTED. What the interstitial REPORTS, which is
// `screens/challenge-perfect-result`'s and `screens/challenge-hit-count`'s; what a
// cleared stage PAYS, which is the `scoring` group's; and what a challenge stage is
// made of, which is the `stages` group's.

import { afterEach, beforeEach, it } from "vitest";
import { STAGE_CLEARED_HOLD, isChallengeStage } from "../../src/constants";
import { assertBetween, assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  seconds,
  startStage,
  ticksFor,
  type Harness,
} from "../harness";

/** The stage flown: the first challenge stage (specs/stages.md). */
const CHALLENGE_STAGE = 3;

/**
 * How far the measured hold may fall from `STAGE_CLEARED_HOLD`, as a fraction.
 *
 * The `20%` the review item states. `specs/ui.md` fixes the hold at `2.6` seconds and
 * says nothing about how it is counted down, so the band has to cover a build that
 * runs its timer off the frame's delta, one that runs it off an accumulated clock, and
 * one that counts whole frames.
 */
const HOLD_TOLERANCE = 0.2;

/**
 * How long the flyover is given to finish.
 *
 * `specs/stages.md` releases `CHALLENGE_GROUPS` (`5`) groups on the `ENTER_GROUP_GAP`
 * (`0.6` second) schedule and gives each eight seconds to leave, so a conformant
 * flyover is over inside `11` seconds; `25` is room for a build that lets its groups
 * take the whole of theirs. A bound on the scenario rather than a threshold on the
 * build.
 */
const MAX_FLYOVER_FRAMES = ticksFor(25);

/**
 * The most frames the hold's own sweep may run before giving up.
 *
 * Twice the hold, which is well past the top of the tolerance band: a build whose
 * interstitial never gives way fails on the band below, naming the hold it ran.
 */
const MAX_HOLD_FRAMES = ticksFor(STAGE_CLEARED_HOLD * 2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the stage-cleared screen for STAGE_CLEARED_HOLD and opens the next stage's intro", async () => {
  // The wave the GAME builds for the stage, opened by running its intro out.
  await startStage(h, CHALLENGE_STAGE);
  const opened = h.snapshot();
  assertEqual(opened.screen, "inWave", "the stage's live wave is open");
  assertEqual(opened.stage, CHALLENGE_STAGE, "at the stage that was started");
  assertEqual(
    opened.isChallenge,
    isChallengeStage(CHALLENGE_STAGE),
    `stage ${String(CHALLENGE_STAGE)} is a challenge stage (specs/stages.md)`,
  );

  // The flyover, played out by the build alone.
  const finished = await h.until((s) => s.screen === "stageCleared", {
    maxFrames: MAX_FLYOVER_FRAMES,
    poll: 1,
  });
  assertTrue(
    finished.hit,
    "the challenge stage finishing inside " +
      `${String(seconds(MAX_FLYOVER_FRAMES))} seconds and opening the ` +
      "stage-cleared interstitial — a flyover's groups each leave the field " +
      "within eight seconds of their release, and the stage ends when the last " +
      "of its drones has left or been destroyed (specs/stages.md); the game " +
      `was on ${finished.snapshot.screen} with ` +
      `${String(finished.snapshot.drones.length)} drones still on the field`,
  );

  // The hold itself, a frame at a time from the frame the screen opened on.
  const swept = await h.until((s) => s.screen !== "stageCleared", {
    maxFrames: MAX_HOLD_FRAMES,
    poll: 1,
  });
  captureStill(h, "next");

  const held = seconds(swept.frames);
  assertTrue(
    swept.hit,
    "the stage-cleared screen giving way inside " +
      `${String(seconds(MAX_HOLD_FRAMES))} seconds — it lasts ` +
      `STAGE_CLEARED_HOLD (${String(STAGE_CLEARED_HOLD)}) seconds and then ` +
      "opens the next stage's intro (specs/ui.md)",
  );
  assertBetween(
    held,
    STAGE_CLEARED_HOLD * (1 - HOLD_TOLERANCE),
    STAGE_CLEARED_HOLD * (1 + HOLD_TOLERANCE),
    "the seconds the stage-cleared screen stood — STAGE_CLEARED_HOLD is " +
      `${String(STAGE_CLEARED_HOLD)} seconds (specs/ui.md), within ` +
      `${String(HOLD_TOLERANCE * 100)}%`,
  );
  assertEqual(
    swept.snapshot.screen,
    "stageIntro",
    "the screen the hold gave way to — the interstitial opens the NEXT " +
      "STAGE'S INTRO (specs/ui.md)",
  );
  assertEqual(
    swept.snapshot.stage,
    CHALLENGE_STAGE + 1,
    'the stage that intro opened at — the interstitial gives way "with the ' +
      'stage number one higher" (specs/ui.md)',
  );
});
