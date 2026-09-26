// Shatter — the wave loop (`specs/progression.md`).
//
// A wave clears on the TICK IN WHICH the last rock on the field is destroyed.
// That is a transition rather than a condition on the field, and the difference
// is the whole of this file: a field that holds no rocks and has had none
// destroyed on that tick is a wave being played, not a wave cleared. So the
// test below reads what the tick DID — `ev.rocksDestroyed` — beside what the
// field now holds, and an emptied field raises nothing on its own.
//
// The order within a banner is fixed wherever one runs: the wave number
// advances and the banner appears on the tick of the clear, the banner runs for
// `WAVE_BANNER_TIME`, and the wave it announces spawns as it ends. No rock is on
// the field at any point while it is showing.

import {
  ROCK_SPEED_MAX,
  ROCK_SPEED_MIN,
  WAVE_BANNER_TIME,
  WAVE_BASE_ROCKS,
  WAVE_MIN_SHIP_DIST,
  WAVE_MIN_STAR_DIST,
  WAVE_SPEED_CAP,
  WAVE_SPEED_STEP,
  FIELD_H,
  FIELD_W,
  STAR_X,
  STAR_Y,
  TICK_DT,
} from "./constants";
import { distance } from "./field";
import { range } from "./rng";
import { addRock } from "./rocks";
import { countDown, type Sim, type TickEvents } from "./sim";

/** How many attempts a spawn point gets at clearing the ship and the star. */
const PLACEMENT_TRIES = 300;

/** The drift multiplier wave `n` carries, capped from wave 11 onward. */
export function waveSpeedScale(n: number): number {
  return 1 + Math.min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (n - 1));
}

/** How many Large rocks wave `n` puts up. */
export function waveRockCount(n: number): number {
  return WAVE_BASE_ROCKS + n;
}

/**
 * A point clear of both the ship and the star, by the shortest wrapped
 * separation.
 *
 * The two exclusions leave most of the field open, so the rejection loop
 * almost always lands on its first try; the fallback keeps the best candidate
 * it saw so a wave always arrives.
 */
function pickSpawnPoint(sim: Sim): readonly [number, number] {
  let bestX = 0;
  let bestY = 0;
  let bestClearance = -1;

  for (let tries = 0; tries < PLACEMENT_TRIES; tries += 1) {
    const x = range(0, FIELD_W);
    const y = range(0, FIELD_H);

    const fromShip = distance(x, y, sim.ship.x, sim.ship.y);
    const fromStar = distance(x, y, STAR_X, STAR_Y);
    if (fromShip >= WAVE_MIN_SHIP_DIST && fromStar >= WAVE_MIN_STAR_DIST) {
      return [x, y];
    }

    const clearance = Math.min(
      fromShip - WAVE_MIN_SHIP_DIST,
      fromStar - WAVE_MIN_STAR_DIST,
    );
    if (clearance > bestClearance) {
      bestClearance = clearance;
      bestX = x;
      bestY = y;
    }
  }

  return [bestX, bestY];
}

/** Put wave `n` up: `WAVE_BASE_ROCKS + n` Large rocks, each drifting. */
export function spawnWave(sim: Sim, n: number): void {
  const scale = waveSpeedScale(n);
  const count = waveRockCount(n);
  // A posed `nextRockSpeed` is the base speed of every rock of this placement,
  // and the placement consumes it (`specs/instrumentation.md`).
  const posed = sim.nextRockSpeed;
  sim.nextRockSpeed = null;

  for (let i = 0; i < count; i += 1) {
    const [x, y] = pickSpawnPoint(sim);

    const bearing = range(0, Math.PI * 2);
    const base = posed ?? range(ROCK_SPEED_MIN.large, ROCK_SPEED_MAX.large);

    const speed = base * scale;
    addRock(
      sim,
      "large",
      x,
      y,
      Math.cos(bearing) * speed,
      Math.sin(bearing) * speed,
    );
  }
}

/**
 * The wave loop, once per tick.
 *
 * A banner already running runs down whether or not the gate is on; what the
 * gate holds back is the field ever filling again, and the wave number ever
 * advancing.
 */
export function runWaveLoop(sim: Sim, ev: TickEvents): void {
  if (sim.waveBanner > 0) {
    sim.waveBanner = countDown(sim.waveBanner, TICK_DT);
    if (sim.waveBanner === 0 && sim.waveSpawning) spawnWave(sim, sim.wave);
    return;
  }

  if (!sim.waveSpawning) return;
  if (ev.rocksDestroyed === 0 || sim.rocks.length > 0) return;

  sim.wave += 1;
  sim.waveBanner = WAVE_BANNER_TIME;
}
