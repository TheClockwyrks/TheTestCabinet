// Meltdown — instrumentation/reset-seeds-randomness: reset seeds the game's
// randomness.
//
// specs/instrumentation.md, A deterministic core: "Any randomness the game uses
// runs off a generator seeded from the state's generator field, and it keeps its
// whole generator state in that field, so reseeding and replaying the same calls
// reproduces the same result exactly. The vent each unit enters at is drawn from
// it." And of `reset`: "`options.seed`, a number defaulting to `DEFAULT_SEED`
// (`1`), seeds all of the game's randomness." specs/waves.md says the same thing
// from the other end: "Each unit's vent is drawn from the game's seeded generator
// ... That draw is the only randomness in the game, so a run replayed from the
// same seed releases the same sequence of vents."
//
// THE VENT SEQUENCE IS THE ONLY OBSERVABLE THE SPECIFICATION GIVES THIS POINT, so
// it is what is read: the vent of each unit the run's own spawner releases, in
// release order, over one wave.
//
// THREE LEGS, AND THE THIRD IS WHAT MAKES THE FIRST TWO MEAN ANYTHING. Two waves
// released after `reset({ seed: 7 })` must draw the identical sequence — that is
// reproducibility. But a build that draws no randomness at all, releasing every
// unit at the same vent forever, satisfies reproducibility perfectly; so a wave
// after `reset({ seed: 8 })` must draw a DIFFERENT sequence, which is what says
// the sequence was drawn from the seed rather than fixed in the code.
//
// SIXTEEN UNITS, AND THE LENGTH IS DELIBERATE. Each draw is one of two vents, so a
// sequence of sixteen is one of 65 536: two different seeds agreeing on the whole
// of it is not something a generator worth the name does, while a shorter run
// would leave the third leg to chance. The window is also short enough that
// nothing leaks under the reading — specs/waves.md releases one unit every
// `WAVE_SPAWN_INTERVAL` (`0.6`) seconds, so sixteen are out in `9` seconds, and
// the first Mote released needs longer than that to cross the floor at its
// specified `60` logical units per second (specs/surge.md). Every unit the
// spawner releases is therefore still on the roster to be read.
//
// THE WORLD GATE IS TURNED ON HERE, and this is one of the two items in this group
// whose requirement it is: what is being read is the run's OWN release of surge,
// which is exactly what `setWaveSpawning` gates (specs/instrumentation.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotEqual } from "../assert";
import { WAVE_SPAWN_INTERVAL } from "../constants";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";

/** The two seeds read, and how many units each wave is read across. */
const SEED_A = 7;
const SEED_B = 8;
const UNITS = 16;

/**
 * How long a leg is driven for: the release of `UNITS` units, and half again.
 *
 * Geometry rather than a tolerance — it says how long the drive runs, not how far
 * a build may miss a figure by. specs/waves.md releases the first unit on the
 * frame the wave begins and one every `WAVE_SPAWN_INTERVAL` after it, so sixteen
 * are out in `9` seconds; half again carries a build whose cadence is two thirds
 * of the specified one, and `surge` is what decides the cadence itself.
 */
const LEG_TICKS = ticksFor(1.5 * (UNITS - 1) * WAVE_SPAWN_INTERVAL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Reset on `seed`, open a wave with the run's own release on, and hand back the
 * vent of each of the first `UNITS` units released, in release order.
 *
 * Nothing but the wave is posed: `reset` empties both rosters, clears the
 * spawner's clock and turns the world gate back on, so the release is the game's
 * own from the frame the phase is entered (specs/instrumentation.md).
 */
async function ventsAfterReset(seed: number): Promise<string[]> {
  h.debug.reset({ seed });
  h.debug.setScreen("playing");
  h.debug.setPhase("wave");
  h.debug.setWave(1);
  h.debug.setWavePending(UNITS);
  h.debug.setWaveSpawning(true);

  const seen = new Set<number>();
  const vents: string[] = [];
  for (let frame = 0; frame < LEG_TICKS && vents.length < UNITS; frame += 1) {
    await h.advance(1);
    for (const unit of h.snapshot().surge) {
      if (seen.has(unit.id)) continue;
      seen.add(unit.id);
      vents.push(unit.vent);
    }
  }
  return vents;
}

it("draws the same vents twice from one seed, and different vents from another", async () => {
  const once = await ventsAfterReset(SEED_A);
  captureStill(h, "seeded");
  assertLength(
    once,
    UNITS,
    `precondition: the wave released ${UNITS} units on seed ${SEED_A}`,
  );

  const again = await ventsAfterReset(SEED_A);
  assertEqual(
    again.join(""),
    once.join(""),
    `two waves released after reset({ seed: ${SEED_A} }) draw the same vents`,
  );

  const other = await ventsAfterReset(SEED_B);
  assertLength(
    other,
    UNITS,
    `precondition: the wave released ${UNITS} units on seed ${SEED_B}`,
  );
  assertNotEqual(
    other.join(""),
    once.join(""),
    `a wave after reset({ seed: ${SEED_B} }) draws a different sequence`,
  );
});
