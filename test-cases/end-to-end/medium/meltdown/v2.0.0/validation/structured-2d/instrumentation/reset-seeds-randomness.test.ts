// Meltdown — instrumentation/reset-seeds-randomness: `reset` seeds the game's
// randomness.
//
// `specs/instrumentation.md`, A deterministic core: "Any randomness the game uses
// runs off a generator seeded from the state's generator field, and it keeps its
// whole generator state in that field, so reseeding and replaying the same calls
// reproduces the same result exactly." And `options.seed` "seeds all of the
// game's randomness". `specs/waves.md` names the one draw there is: "Each unit's
// vent is drawn from the game's seeded generator, the two vents equally likely.
// That draw is the only randomness in the game, so a run replayed from the same
// seed releases the same sequence of vents."
//
// SO THE VENT SEQUENCE IS THE GENERATOR, READ OUT LOUD. Nothing else in the game
// draws, which is why this point reads vents rather than anything else: it is the
// only observable the seed reaches.
//
// TWO RELEASES FROM ONE SEED, AND ONE FROM ANOTHER. The identical pair is the
// requirement — a build whose generator was seeded from the clock, or from an
// object identity, or not at all, disagrees with itself. The third leg is what
// stops a build that IGNORES the seed passing the first: a generator hard-wired
// to one stream replays identically from any seed, so it reads the same sequence
// under `8` as under `7` and fails here.
//
// THE RUN LENGTH IS WHAT MAKES THE THIRD LEG SOUND. Each draw is one of two
// vents, so two unrelated streams agree on a single unit half the time; over the
// twenty units released below they agree by chance about once in a million. A
// build that seeds properly is in no danger from that, and one that ignores the
// seed cannot escape it.
//
// EACH RELEASE IS THE RUN'S OWN. The world gate is turned back on and the wave
// phase is posed with units owed, so the spawner releases them at the cadence
// `specs/waves.md` fixes and draws each vent as it goes. Nothing is added by
// hand: `addUnit` takes the vent from its caller and would draw nothing at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
  type VentName,
} from "../harness";

/** The seed two of the three releases are drawn from, and the odd one out. */
const SEED = 7;
const OTHER_SEED = 8;

/**
 * How many units each release is read over.
 *
 * Two vents, equally likely, so two unrelated streams agree on one unit half the
 * time and on twenty about once in a million (`2^-20`). That is what lets the
 * third leg read "a different sequence" as a verdict rather than as a coin toss.
 */
const UNITS = 20;

/**
 * How long the release is given, in frames of the suite's clock.
 *
 * Geometry rather than a tolerance: `specs/waves.md` releases one unit every
 * `WAVE_SPAWN_INTERVAL` (`0.6`) seconds, so twenty units take twelve seconds. The
 * sweep below is given four times that, so a build whose cadence is off still
 * releases its twenty and the sequence this point reads rests on the draw rather
 * than on the timing.
 */
const RELEASE_FRAMES = ticksFor(48);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Reset to `seed`, open a wave owed `UNITS` units, and read the vent of each one
 * in the order the spawner released it.
 *
 * Units are collected by id as they appear rather than off the roster at the end,
 * so a unit that crossed the floor and left before the twentieth arrived is still
 * counted — the sequence is of what was RELEASED, which is what the generator
 * decides.
 */
async function ventsFrom(seed: number): Promise<VentName[]> {
  h.debug.reset(seed);
  h.debug.setScreen("playing");
  h.debug.setPhase("wave");
  h.debug.setWavePending(UNITS);
  h.debug.setWaveSpawning(true);

  const vents: VentName[] = [];
  const seen = new Set<number>();
  for (
    let frame = 0;
    frame < RELEASE_FRAMES && vents.length < UNITS;
    frame += 1
  ) {
    await h.advance(1);
    for (const unit of h.snapshot().surge) {
      if (seen.has(unit.id)) continue;
      seen.add(unit.id);
      vents.push(unit.vent);
    }
  }
  return vents;
}

it("draws the same vents from one seed and different vents from another", async () => {
  const first = await ventsFrom(SEED);
  captureStill(h, "seeded");
  assertEqual(
    first.length,
    UNITS,
    `precondition: the wave released ${UNITS} units to draw vents for`,
  );

  const second = await ventsFrom(SEED);
  assertEqual(
    second.length,
    UNITS,
    "precondition: the replay released the same number of units",
  );
  assertDeepEqual(
    second,
    first,
    `the vents drawn on a second release after reset(${SEED})`,
  );

  const other = await ventsFrom(OTHER_SEED);
  assertEqual(
    other.length,
    UNITS,
    "precondition: the third release released the same number of units",
  );
  assertNotEqual(
    other.join(""),
    first.join(""),
    `the vents drawn after reset(${OTHER_SEED}), against seed ${SEED}'s`,
  );
});
