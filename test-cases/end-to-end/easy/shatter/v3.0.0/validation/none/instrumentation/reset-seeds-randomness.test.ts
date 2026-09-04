// instrumentation/reset-seeds-randomness — `reset({ seed })` really seeds the
// game's randomness: two games opened on one seed put up the same wave-1 layout,
// and a game opened on another seed puts up a different one.
//
// WHY THIS ITEM EXISTS AT ALL. `specs/simulation.md` names six draws the game makes
// and requires every one of them to run off a generator seeded from the state, "so
// reseeding and replaying the same calls reproduces the same result exactly". That
// property is what the rest of this project rests on: a scenario driven from code
// is only reproducible if the build's randomness is. A build that reaches for
// `Math.random` passes almost every other item in the case and fails this one.
//
// THE LAYOUT IS REACHED THE WAY A PLAYER REACHES IT. Nothing here is posed: a wave
// is not something `setWave` can produce — `specs/instrumentation.md` says posing
// the wave spawns nothing — so the game is opened from a reset title by confirming
// `PLAY`, and what is read is the wave the game's own spawner put up.
//
// AND IT IS READ WHEN IT ARRIVES, NOT AT A FIXED MOMENT. `specs/progression.md`
// allows either opening for wave 1: the rocks at once, or a `WAVE 1` banner first
// with the rocks spawned as it ends. So each run sweeps until the wave is on the
// field, and the TICK it arrived on is compared as well as the layout — a build
// whose randomness is seeded but whose banner is not would otherwise pass on the
// positions alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertTrue } from "../assert";
import { WAVE_BANNER_TIME, waveRockCount } from "../constants";
import {
  captureStill,
  createHarness,
  startGameFromTitle,
  ticksFor,
  type Harness,
  type ShatterSnapshot,
} from "../harness";

/** The seed two of the three runs are opened on. */
const SEED = 7;
/** The seed the third run is opened on, so its draws must differ. */
const OTHER_SEED = 8;

/** Wave 1's rock count, which is what a run sweeps until the field holds. */
const WAVE_ONE_ROCKS = waveRockCount(1);

/**
 * How long a run is given for its opening wave to appear.
 *
 * The banner is the longest either permitted opening can take
 * (`WAVE_BANNER_TIME`, 1.5 seconds), plus half a second so a build that raises the
 * banner on the tick after the game opens is not cut off by the ceiling. It bounds
 * a build that never spawns rather than fixing a schedule: a build that spawns at
 * once is read on its first tick.
 */
const OPENING_TICKS = ticksFor(WAVE_BANNER_TIME + 0.5);

/**
 * The decimal places a layout is compared to.
 *
 * Three, which is far below anything a different draw could produce and far above
 * floating-point noise: `specs/simulation.md` requires a replayed seed to reproduce
 * the result EXACTLY, so two runs on one seed agree bit for bit and the rounding
 * is only insurance against a number that made a round trip through JSON.
 */
const LAYOUT_PLACES = 3;

/** A wave's layout as one comparable string: every rock, in roster order. */
function layoutOf(snapshot: ShatterSnapshot): string {
  return JSON.stringify(
    snapshot.rocks.map((rock) => [
      rock.size,
      rock.x.toFixed(LAYOUT_PLACES),
      rock.y.toFixed(LAYOUT_PLACES),
      rock.vx.toFixed(LAYOUT_PLACES),
      rock.vy.toFixed(LAYOUT_PLACES),
    ]),
  );
}

let h: Harness;

/** Open a game on `seed` and read the opening wave the moment it is on the field. */
async function openingWave(
  seed: number,
): Promise<{ ticks: number; layout: string }> {
  await startGameFromTitle(h, { seed });
  const arrived = await h.skipUntil(
    (snapshot) => snapshot.rocks.length >= WAVE_ONE_ROCKS,
    { maxTicks: OPENING_TICKS, poll: 1 },
  );
  assertTrue(
    arrived.hit,
    `wave 1 put up its ${WAVE_ONE_ROCKS} rocks (specs/progression.md)`,
  );
  return { ticks: arrived.ticks, layout: layoutOf(arrived.snapshot) };
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the same wave twice on one seed, and a different one on another", async () => {
  const first = await openingWave(SEED);
  const second = await openingWave(SEED);
  await captureStill(h, "seeded");

  assertEqual(
    second.layout,
    first.layout,
    `the wave-1 layout two runs on seed ${SEED} both produced`,
  );
  assertEqual(
    second.ticks,
    first.ticks,
    `the tick wave 1 arrived on, on seed ${SEED}`,
  );

  // And the seed is really the seed: another one draws another layout. A build
  // that accepts the parameter and ignores it reads identically here.
  const other = await openingWave(OTHER_SEED);
  assertNotEqual(
    other.layout,
    first.layout,
    `the wave-1 layout on seed ${OTHER_SEED} differs from seed ${SEED}'s`,
  );
});
