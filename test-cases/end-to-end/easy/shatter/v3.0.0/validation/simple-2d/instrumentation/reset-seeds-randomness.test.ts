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
// `PLAY`, and what is read is the wave the game's own spawner put up. `reset`
// restores both world gates to on, so the route needs no gate turned back on.
//
// AND IT IS READ WHEN IT ARRIVES, NOT AT A FIXED MOMENT. `specs/progression.md`
// allows either opening for wave 1: the rocks at once, or a `WAVE 1` banner first
// with the rocks spawned as it ends. So each run sweeps until the wave is on the
// field, and the GAME TIME it arrived at is compared as well as the layout — a
// build whose randomness is seeded but whose banner is not would otherwise pass on
// the positions alone. `reset` sets `simTime` to `0`, so that reading is measured
// from the reset itself.

import { afterEach, beforeEach, it } from "vitest";
import { WAVE_BANNER_TIME, WAVE_BASE_ROCKS } from "../../src/constants";
import { assertEqual, assertNotEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  tapAction,
  ticksFor,
  type Harness,
} from "../harness";
import type { ShatterSnapshot } from "../surface";

/** The seed two of the three runs are opened on. */
const SEED = 7;
/** The seed the third run is opened on, so its draws must differ. */
const OTHER_SEED = 8;

/** Wave 1's rock count: `WAVE_BASE_ROCKS + N` (`specs/progression.md`). */
const WAVE_ONE_ROCKS = WAVE_BASE_ROCKS + 1;

/**
 * How long a run is given for its opening wave to appear, in ticks.
 *
 * The banner is the longest either permitted opening can take
 * (`WAVE_BANNER_TIME`, 1.5 seconds), plus half a second so a build that raises the
 * banner on the tick after the game opens is not cut off by the ceiling. It bounds
 * a build that never spawns rather than fixing a schedule: a build that spawns at
 * once is read on its first tick.
 */
const OPENING_FRAMES = ticksFor(WAVE_BANNER_TIME + 0.5);

/**
 * The decimal places a layout is compared to.
 *
 * Three, which is far below anything a different draw could produce and far above
 * floating-point noise: `specs/simulation.md` requires a replayed seed to reproduce
 * the result EXACTLY, so two runs on one seed agree bit for bit and the rounding
 * is only insurance.
 */
const LAYOUT_PLACES = 3;

/** The decimal places the arrival moment is compared to: exactly. */
const ARRIVAL_DIGITS = 6;

let h: Harness;

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

/**
 * Open a game on `seed` from a reset title and read the opening wave the moment
 * it is on the field.
 *
 * The whole route is `reset({ seed })`, one press of the confirm action over the
 * title's first entry — `PLAY`, which `specs/ui.md` says the highlight rests on
 * when the title is arrived at — and then a sweep. Nothing is posed.
 */
async function openingWave(
  seed: number,
): Promise<{ at: number; layout: string }> {
  h.debug.reset({ seed });
  assertEqual(h.snapshot().screen, "title", `reset({ seed: ${seed} }) opened`);
  assertEqual(h.snapshot().menuIndex, 0, "the highlight rests on PLAY");
  await tapAction(h, "confirm");

  const arrived = await h.until(
    (snapshot) => snapshot.rocks.length >= WAVE_ONE_ROCKS,
    { maxFrames: OPENING_FRAMES, poll: 1 },
  );
  assertTrue(
    arrived.hit,
    `wave 1 put up its ${WAVE_ONE_ROCKS} rocks (specs/progression.md)`,
  );
  return { at: arrived.snapshot.simTime, layout: layoutOf(arrived.snapshot) };
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the same wave twice on one seed, and a different one on another", async () => {
  const first = await openingWave(SEED);
  const second = await openingWave(SEED);
  captureStill(h, "seeded");

  assertEqual(
    second.layout,
    first.layout,
    `the wave-1 layout two runs on seed ${SEED} both produced`,
  );
  assertEqual(
    second.at.toFixed(ARRIVAL_DIGITS),
    first.at.toFixed(ARRIVAL_DIGITS),
    `the game time wave 1 arrived at, on seed ${SEED}`,
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
