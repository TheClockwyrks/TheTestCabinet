// waves/lives-never-regenerate — nothing a run does ever gives a life back.
//
// specs/waves.md, Victory and loss: "Lives never regenerate." specs/surge.md says
// it of the leak that takes them: "Lives lost to a leak never come back."
//
// THE STRETCH IS A WAVE CLEARED WITHOUT A LEAK, AND THE BUILD PHASE IT OPENS.
// That is where a build would give one back if it gave one back anywhere: a clear
// is the transition that pays this game's bonuses — the wave-clear bonus, its
// score, and the interest of the build phase that follows (specs/economy.md) — so a
// build that treats lives as one more thing a cleared wave pays shows it here. The
// wave is cleared by a KILL rather than a leak, so nothing about the drive spends
// a life and the lives can only move upward.
//
// THE COUNT IS POSED TO `7`, not left at the mode's own `20`. A build that
// restores the lives to the mode's starting figure on a clear is the exact defect
// this point is looking for, and against a run posed at `20` it would be invisible.
// Seven is far from both `20` and `0`, so a build that resets, tops up, or adds one
// lands on a different number.
//
// IT IS WATCHED THROUGHOUT RATHER THAN READ AT THE END, because a build that
// granted a life on the clear and spent it again a moment later would pass a
// reading taken only afterwards. Every sample must read `7`, so the lives are held
// to a ceiling for the whole stretch and not merely at the end of it.
//
// THE MARK'S MOTION IS OFF (`waves/run.ts`), which is what keeps the drive
// leak-free: a walking mark could reach its exhaust and charge a life, and the
// reading would then be about the leak rather than about regeneration.
//
// WHAT EVERY WRONG MODEL READS. A build that restores the mode's starting lives on
// a clear reads `20`; one that pays a life per wave cleared reads `8`; one that
// pays a life per unit killed reads `8`. A conformant build reads `7` at every
// sample.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  seconds,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import {
  poseGun,
  poseMark,
  poseWaveEnd,
  runUntilKilled,
  watchOver,
} from "./run";

/** The wave cleared: an ordinary one, well short of the run's last. */
const WAVE = 1;

/** The lives the run holds: far from the mode's own figure and far from zero. */
const LIVES = 7;

/** The game time watched after the clear: four seconds of the build phase it opened. */
const AFTER_TICKS = ticksFor(4);

/** How often the lives are read, in frames: eight times a second. */
const POLL = ticksFor(1 / 8);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the lives at their posed count across a clear and the phase it opens", async () => {
  startRun(h);
  poseWaveEnd(h, WAVE);
  h.debug.setLives(LIVES);
  poseGun(h);
  poseMark(h);

  const opened = h.snapshot().lives;
  const killed = await runUntilKilled(h);
  const cleared = h.snapshot();
  const after = await watchOver(
    h,
    AFTER_TICKS,
    POLL,
    (snapshot) => snapshot.lives,
  );

  captureStill(h, "lives");

  assertTrue(killed, "precondition: the wave's last unit died");
  assertEqual(
    cleared.phase,
    "building",
    "precondition: the kill cleared the wave",
  );
  for (const [index, lives] of [opened, ...after].entries()) {
    assertEqual(
      lives,
      LIVES,
      `the lives ${seconds(index * POLL).toFixed(1)} s into the stretch`,
    );
  }
});
