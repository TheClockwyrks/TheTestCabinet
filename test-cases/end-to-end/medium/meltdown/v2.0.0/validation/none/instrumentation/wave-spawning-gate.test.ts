// Meltdown — instrumentation/wave-spawning-gate: with the world gate shut, the
// run's own release of surge stays away; with it open, the roster fills.
//
// THE RULE. `specs/instrumentation.md` gives `setWaveSpawning(enabled)` as gating
// "The run's own release of surge: the build timer's automatic start of the next
// wave when it reaches `0`, and the spawner's release of the units counted by
// `wavePending`. Off, no unit arrives unless one is added."
//
// WHY EVERY SCENARIO IN THIS PROJECT DEPENDS ON IT. `startRun` shuts this gate,
// and it is the ONLY reason a check may spend more than a second of game time on
// a live `playing` screen. Without it a wave releases a unit every
// `WAVE_SPAWN_INTERVAL` (`0.6` seconds, `specs/waves.md`) into a floor the check
// posed exactly — and every heat, combat, mazing and economy reading in the suite
// is then taken on a floor that has been invaded by units nobody asked for, with
// the failures landing anywhere but here.
//
// THE GATE IS THE RUN'S OWN FACULTY, WHICH IS WHY THE POSE IS FAIR. A check that
// parked a bystander in a corner would be leaning on the game's own rules holding;
// shutting the spawner is holding the run, not hiding an entity, and this item is
// one of the handful whose requirement the gate IS.
//
// THE QUIET LEG IS DELIBERATELY LONG. A minute of game time is a hundred releases
// at the specification's cadence, so a build whose gate merely SLOWED the spawner,
// or whose gate is read once and cached, has a hundred chances to be caught. And
// the leg is watched by sampling rather than by one reading at the end: a unit
// that appeared and leaked inside the minute would be gone by then, so the sweep
// looks for a non-empty roster throughout, and `wavePending` is held to the count
// it was posed at as the second witness that nothing was released.
//
// THE OPEN LEG POSES THE IDENTICAL FLOOR and asks only that the roster fills,
// because THAT is the contrast the gate is: a build with no spawner at all passes
// the quiet leg outright.
//
// AND THE LIVES ARE POSED ENORMOUS on the open leg, so a leak cannot end the run
// and stop the very release being watched. The lives are a run figure this item is
// not about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import { WAVE_SPAWN_INTERVAL } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The units counted onto the wave the gate must hold back. */
const PENDING = 30;

/** How long the shut gate is watched, in seconds of game time, and how often. */
const QUIET_SECONDS = 60;
const SAMPLE_SECONDS = 0.2;
/** Frames of game time per second inside a sample. Coarse, because none is read. */
const SAMPLE_HZ = 30;

/**
 * How long the open gate is watched, and how many units must have arrived by then.
 *
 * At the specification's cadence of one release every `WAVE_SPAWN_INTERVAL`
 * (`0.6` s), five seconds carries eight releases. The floor of `5` is well under
 * that, because how fast the spawner releases is `surge/spawn-cadence`'s item and
 * this one asks only that the gate let the release happen at all.
 */
const OPEN_SECONDS = 5;
const MIN_RELEASED = 5;

/** Lives no leak in these windows can exhaust. */
const UNENDING_LIVES = 1_000_000;

let h: Harness;

/** Pose a live wave phase with `PENDING` units counted onto it and nothing released. */
async function poseAWaitingWave(): Promise<void> {
  await startRun(h);
  await h.debug.setLives(UNENDING_LIVES);
  await h.debug.setPhase("wave");
  await h.debug.setWavePending(PENDING);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("releases nothing over a minute with the gate shut", async () => {
  await poseAWaitingWave();
  assertEqual(
    (await h.snapshot()).waveSpawning,
    false,
    "the world gate the run was posed with",
  );

  const swept = await h.skipUntil((snapshot) => snapshot.surge.length > 0, {
    maxSeconds: QUIET_SECONDS,
    pollSeconds: SAMPLE_SECONDS,
    hz: SAMPLE_HZ,
  });
  await captureStill(h, "quiet");

  assertEqual(
    swept.hit,
    false,
    `a unit arrived within ${QUIET_SECONDS} seconds of game time with the gate shut`,
  );
  assertLength(swept.snapshot.surge, 0, "the surge roster with the gate shut");
  assertEqual(
    swept.snapshot.wavePending,
    PENDING,
    "the units still to release, after a minute with the gate shut",
  );
});

it("fills the roster with the gate open", async () => {
  await poseAWaitingWave();
  await h.debug.setWaveSpawning(true);

  const swept = await h.skipUntil(
    (snapshot) => snapshot.surge.length >= MIN_RELEASED,
    { maxSeconds: OPEN_SECONDS, pollSeconds: SAMPLE_SECONDS, hz: SAMPLE_HZ },
  );
  await captureStill(h, "released");

  assertGreaterThanOrEqual(
    swept.snapshot.surge.length,
    MIN_RELEASED,
    `units released within ${OPEN_SECONDS} seconds with the gate open, ` +
      `at one every ${WAVE_SPAWN_INTERVAL} seconds`,
  );
});
