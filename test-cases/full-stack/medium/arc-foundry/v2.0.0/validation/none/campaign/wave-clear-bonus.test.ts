// campaign/wave-clear-bonus — clearing wave n pays its flat bonus.
//
// specs/economy.md's income table: "Wave-clear bonus — `WAVE_BONUS_BASE +
// WAVE_BONUS_STEP * waveNumber`, with `WAVE_BONUS_BASE` (`8`) and
// `WAVE_BONUS_STEP` (`2`). Wave `1` therefore pays `10`." It "is paid when the
// wave clears, which is when every unit the wave released has died or leaked."
//
// Three waves are launched and cleared, and the Charge the clear paid is read as
// the difference across it. The three are spread along the run — `1`, `6` and
// `20` — because the rule is a line in the wave number and a build carrying a
// flat bonus, or one stepping by the wrong amount, agrees with the line at one
// point and parts from it at the others.
//
// EACH WAVE IS POSED RATHER THAN COMPOSED. The bonus is "a function of the wave
// number and of nothing else", so what this point needs is a live wave AT a
// chosen number and the game's own clear-and-pay resolution running on it —
// nothing about what the wave held. `setWave(n)` sets the number units released
// from now on scale to, and `spawnUnit` "puts the run into a live wave" at that
// number whose "spawn schedule is empty, so the units on the yard are exactly the
// ones `spawnUnit` released and nothing else arrives"; that wave "clears the
// ordinary way ... and clearing it pays the ordinary wave-clear bonus"
// (specs/instrumentation.md), and it spends no wave number, so the counter still
// reads `n` when the bonus lands. What is read is therefore the same resolution a
// composed wave's clear runs, reached directly instead of through a whole wave's
// spawn schedule — which is what `campaign/wave-numbering` and
// `campaign/wave-clears` decide.
//
// ONE OF THE FOUR IS A WAVE THE GAME COMPOSED, AND THAT IS DELIBERATE. The three
// posed clears above carry the LINE, because posing the wave number is the only
// affordable way to reach wave `20`. But a build that pays the bonus off the
// empty-schedule wave `spawnUnit` opens and pays nothing off a wave its own
// spawner filled would satisfy every posed reading and fail the player, so the
// last reading launches wave `COMPOSED` through the level's harvest — the way
// play starts a wave — and reads the same bonus off its clear. The wave is a
// low one, so the schedule it has to exhaust is short.
//
// NOTHING ELSE PAYS INTO THE COUNTER. Charge has one other income, a kill's
// bounty, and each wave here is emptied through `clearUnits`, which kills nothing
// and leaks nothing, so no bounty is ever paid; the yard carries no structure at
// all, so nothing can fire. The two sinks, refining and upgrading, are never
// touched. What crosses the counter is the bonus.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { WAVE_BONUS_BASE, WAVE_BONUS_STEP, waveBonus } from "../constants";
import {
  captureReplay,
  ConstantClock,
  createHarness,
  openYard,
  releaseUnit,
  type Harness,
} from "../harness";
import { clearWave, harvestWave } from "./runs";

/** The waves whose clears are read: the first, an early one, and a deep one. */
const SAMPLE = [1, 6, 20];

/** 20 Hz: coarse, and the simulation is defined to be indifferent to it. */
const HZ = 20;

/** That frame, in milliseconds. */
const CLOCK_MS = 1000 / HZ;

/**
 * A second of the wave running before it is swept, in frames.
 *
 * The bonus is read across the clear either way; this is the interval a reviewer
 * watches the posed wave run in, and it is far short of the walk a Mote released
 * at the entry needs to reach the collector, so nothing leaks under the reading.
 */
const RUNNING = HZ;

/** Ten seconds: a verdict rather than a hang if a build never clears its wave. */
const CLEAR_MAX = 10 * HZ;

/**
 * The wave read off a schedule the game composed for itself.
 *
 * Low, so the schedule the clear has to exhaust is short; `specs/enemies.md`
 * gives every wave a composition, so any wave number would decide the same thing.
 */
const COMPOSED = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(CLOCK_MS) });
});

afterEach(async () => {
  await h.dispose();
});

it("pays WAVE_BONUS_BASE + WAVE_BONUS_STEP * n as wave n clears", async () => {
  const paid = await captureReplay(h, "bonus", async () => {
    const rows: number[] = [];
    for (const wave of SAMPLE) {
      await openYard(h, { wave, charge: 0 });
      await releaseUnit(h, "mote");

      const launched = await h.snapshot();
      assertEqual(
        launched.phase,
        "wave",
        `releasing a unit puts the run into a live wave (specs/instrumentation.md)`,
      );
      assertEqual(
        launched.wave,
        wave,
        `the live wave is wave ${wave}: spawnUnit spends no wave number`,
      );
      const before = launched.charge;

      await h.advance(RUNNING);
      await h.debug.clearUnits();
      const cleared = await h.until((s) => s.phase !== "wave", {
        maxFrames: CLEAR_MAX,
        poll: 1,
      });
      assertEqual(
        cleared.hit,
        true,
        `wave ${wave} to clear once nothing is left on the yard ` +
          "(specs/instrumentation.md)",
      );
      assertEqual(
        cleared.snapshot.phase,
        "build",
        `wave ${wave} cleared into a build phase`,
      );
      assertEqual(
        cleared.snapshot.wave,
        wave,
        `the counter still names wave ${wave} as its bonus is paid`,
      );
      rows.push(cleared.snapshot.charge - before);
    }
    return rows;
  });

  for (const [index, wave] of SAMPLE.entries()) {
    assertEqual(
      paid[index],
      waveBonus(wave),
      `clearing wave ${wave} pays ${WAVE_BONUS_BASE} + ` +
        `${WAVE_BONUS_STEP} * ${wave}`,
    );
  }

  // And the same line off a wave the game composed for itself. The level's
  // harvest launches wave COMPOSED — the only thing that starts a wave in play —
  // and its units are swept with `clearUnits`, which kills nothing and leaks
  // nothing, so the wave clears when its own schedule is exhausted and no bounty
  // crosses the counter. A build that pays only on the posed wave fails here.
  await openYard(h, { wave: COMPOSED - 1, charge: 0 });
  await harvestWave(h, COMPOSED);
  const before = (await h.snapshot()).charge;
  const cleared = await clearWave(h);
  assertEqual(
    cleared.snapshot.phase,
    "build",
    `the composed wave ${COMPOSED} cleared into a build phase`,
  );
  assertEqual(
    cleared.snapshot.charge - before,
    waveBonus(COMPOSED),
    `clearing wave ${COMPOSED}, composed by the game and launched by the ` +
      `level's harvest, pays ${WAVE_BONUS_BASE} + ${WAVE_BONUS_STEP} * ` +
      `${COMPOSED} like every posed wave above`,
  );
});
