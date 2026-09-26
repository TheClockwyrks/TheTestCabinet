// Meltdown — one frame of the run: the surge moves, the emitters fire, the heat
// resolves, the clocks run, and the wave clears (specs/waves.md).
//
// The order below is the order the rules need, and each step is here for a
// reason:
//
//   1. slow timers, so a slow applied last frame has lasted exactly its time;
//   2. movement, so range and targeting read where a unit actually is;
//   3. leaks, because a unit that reached its exhaust has left before any tower
//      could shoot it;
//   4. firing, which counts this frame's shots;
//   5. deaths, paying each bounty once;
//   6. the heat pass, which needs those shot counts and writes every new heat
//      together (`src/heat.ts`);
//   7. the run's own clocks — the build timer and the wave spawner;
//   8. the wave clear, which is a TRANSITION: it happens on the frame a unit
//      died or leaked with nothing left to release, so a phase that never
//      released a unit never clears.
//
// Nothing here reads the renderer, the wall clock, or the canvas, which is what
// lets a driven scenario advance the game a frame at a time and get the same
// answer every time.

import {
  BUILD_PHASE_TIME,
  CUES,
  EARLY_SEND_PER_SECOND,
  INTEREST_CAP,
  INTEREST_RATE,
  SCORE_VICTORY_PER_LIFE,
  SCORE_WAVE_CLEAR,
  WAVE_CLEAR_BASE,
  WAVE_CLEAR_PER_WAVE,
  WAVE_SPAWN_INTERVAL,
  inBounds,
  tileCX,
  tileCY,
} from "./constants";
import { SURGE_DEFS } from "./defs";
import { resolveCombat } from "./combat";
import type { CueSink } from "./build";
import { OPENING_TILES, idx } from "./grid";
import { resolveHeat } from "./heat";
import { modeFigures } from "./modes";
import type { MeltdownState, Unit } from "./state";
import {
  atExhaust,
  createUnit,
  exhaustOf,
  exhaustPoint,
  fliesOf,
  speedOf,
  tileOf,
} from "./units";
import { releaseCount, releaseHpScale, releaseTypeAt } from "./waves";
import type { SurgeType, Vent } from "./types";

/** The mode's derived figures for the run the state is on. */
function figuresOf(state: MeltdownState) {
  return modeFigures(state.mode, state.difficulty);
}

/** Add one unit to the floor, entering it into the same systems a release does. */
export function addUnit(
  state: MeltdownState,
  type: SurgeType,
  vent: Vent,
  spread = 0,
): Unit {
  const unit = createUnit(
    state.nextId,
    type,
    vent,
    state.floor,
    releaseHpScale(state.mode, state.wave),
    spread,
  );
  state.nextId += 1;
  state.surge.push(unit);
  return unit;
}

/** Remove one unit. It costs no life, pays no bounty, and changes no score. */
export function removeUnit(state: MeltdownState, id: number): void {
  const index = state.surge.findIndex((unit) => unit.id === id);
  if (index >= 0) state.surge.splice(index, 1);
}

/** Remove every unit, leaving the towers exactly as they stand. */
export function clearSurge(state: MeltdownState): void {
  state.surge = [];
}

/** One vent draw, the two equally likely: the game's only randomness. */
export function drawVent(): Vent {
  return Math.random() < 0.5 ? "left" : "top";
}

/** The vent a released unit enters at: the posed one, else a draw. */
function ventFor(state: MeltdownState): Vent {
  return state.spawnVent ?? drawVent();
}

/**
 * Release one unit of the current wave, if the run's own release is running.
 *
 * The vent is the posed one while `spawnVent` holds a vent, and otherwise a
 * draw with the two equally likely; that draw is the only randomness in the
 * game (specs/waves.md).
 */
function releaseOne(state: MeltdownState): void {
  if (!state.waveSpawning || state.wavePending <= 0) return;
  const figures = figuresOf(state);
  const total = releaseCount(state.mode, state.wave, figures.waveCount);
  const index = total - state.wavePending;
  const type = releaseTypeAt(state.mode, state.wave, figures.waveCount, index);
  const vent = ventFor(state);
  state.wavePending -= 1;
  addUnit(state, type, vent, state.wavePending);
}

/**
 * Begin the current wave: the phase becomes `wave`, its units are counted onto
 * `wavePending`, every tower loses its freshness, and the first unit is released
 * on this very frame.
 */
export function startWave(state: MeltdownState): void {
  const figures = figuresOf(state);
  state.phase = "wave";
  state.buildTimer = 0;
  state.wavePending = releaseCount(state.mode, state.wave, figures.waveCount);
  state.spawnClock = 0;
  for (const tower of state.towers) tower.fresh = false;
  releaseOne(state);
}

/**
 * The send: begin the coming wave, paying the early-send bonus when it came
 * from a timed build phase and nothing when it came from the untimed opening.
 */
export function send(state: MeltdownState): void {
  if (state.screen !== "playing" || state.phase === "wave") return;
  if (state.phase === "building") {
    state.money += EARLY_SEND_PER_SECOND * Math.floor(state.buildTimer);
  }
  startWave(state);
}

/** Open the game-over screen, on the frame the last life went. */
function loseRun(state: MeltdownState, cue: CueSink): void {
  state.lives = 0;
  state.screen = "gameover";
  state.menuIndex = 0;
  state.build = null;
  state.selected = null;
  cue(CUES.gameOver);
}

/** Advance a unit along its route, or its flight line, by one frame. */
function moveUnit(state: MeltdownState, unit: Unit, dt: number): void {
  if (!unit.motion) return;
  const speed = speedOf(unit);
  if (speed <= 0) return;
  let budget = speed * dt;

  if (fliesOf(unit)) {
    const goal = exhaustPoint(exhaustOf(unit));
    const dx = goal.x - unit.x;
    const dy = goal.y - unit.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= budget || distance === 0) {
      unit.x = goal.x;
      unit.y = goal.y;
      return;
    }
    unit.x += (dx / distance) * budget;
    unit.y += (dy / distance) * budget;
    return;
  }

  const exhaust = exhaustOf(unit);
  const field = state.floor.field(exhaust);
  // Bounded because one frame can cover several tiles at speed, and a fully
  // walled unit must not spin here.
  for (let steps = 0; steps < 64 && budget > 1e-9; steps += 1) {
    const { c, r } = tileOf(unit);
    if (!inBounds(c, r)) return;
    if (OPENING_TILES[exhaust].includes(idx(c, r))) return;
    const next = state.floor.bestNext(c, r, field);
    if (next === null) return;
    const tx = tileCX(next.c);
    const ty = tileCY(next.r);
    const dx = tx - unit.x;
    const dy = ty - unit.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    if (distance <= budget) {
      unit.x = tx;
      unit.y = ty;
      budget -= distance;
    } else {
      unit.x += (dx / distance) * budget;
      unit.y += (dy / distance) * budget;
      budget = 0;
    }
  }
}

/**
 * One whole frame of the run.
 *
 * `dt` is the game time this frame advances by: the frame's elapsed time already
 * multiplied by the game speed.
 */
export function stepSimulation(
  state: MeltdownState,
  dt: number,
  cue: CueSink,
): void {
  if (dt <= 0) return;

  // 1. Slow timers.
  for (const unit of state.surge) {
    if (unit.slowTimer <= 0) continue;
    unit.slowTimer -= dt;
    if (unit.slowTimer <= 0) {
      unit.slowTimer = 0;
      unit.slowFactor = 0;
    }
  }

  // 2 and 3. Movement, then the leaks it produced.
  let ended = false;
  const walked: Unit[] = [];
  for (const unit of state.surge) {
    moveUnit(state, unit, dt);
    if (atExhaust(unit)) {
      state.lives -= SURGE_DEFS[unit.type].leak;
      cue(CUES.leak);
      ended = true;
      continue;
    }
    walked.push(unit);
  }
  if (walked.length !== state.surge.length) state.surge = walked;
  if (state.lives <= 0) {
    loseRun(state, cue);
    return;
  }

  // 4 and 5. Firing, then the deaths it produced.
  const combat = resolveCombat(state, dt);
  if (combat.anyShot) cue(CUES.fire);
  if (combat.deaths.length > 0) {
    for (const dead of combat.deaths) {
      const bounty = SURGE_DEFS[dead.type].bounty;
      state.money += bounty;
      state.score += bounty;
    }
    cue(CUES.death);
    const gone = new Set(combat.deaths.map((unit) => unit.id));
    state.surge = state.surge.filter((unit) => !gone.has(unit.id));
    ended = true;
  }

  // 6. The heat pass, over the shots this frame resolved.
  const tripped = resolveHeat(state.towers, state.floor, dt, combat.shotsFired);
  if (tripped.length > 0) cue(CUES.trip);

  // 7. The run's own clocks.
  if (state.phase === "building") {
    state.buildTimer = Math.max(0, state.buildTimer - dt);
    if (state.buildTimer <= 0 && state.waveSpawning) startWave(state);
  } else if (state.phase === "wave" && state.waveSpawning) {
    state.spawnClock += dt;
    while (state.spawnClock >= WAVE_SPAWN_INTERVAL && state.wavePending > 0) {
      state.spawnClock -= WAVE_SPAWN_INTERVAL;
      releaseOne(state);
    }
  }

  // 8. The wave clear, as a transition.
  if (
    ended &&
    state.phase === "wave" &&
    state.wavePending === 0 &&
    state.surge.length === 0
  ) {
    clearWave(state, cue);
  }

  // The shot traces are drawing alone, and decay with the simulation.
  if (state.shots.length > 0) {
    state.shots = state.shots.filter((shot) => {
      shot.life -= dt;
      return shot.life > 0;
    });
  }
}

/** What a cleared wave pays, and where the run goes next. */
function clearWave(state: MeltdownState, cue: CueSink): void {
  const figures = figuresOf(state);
  const w = state.wave;
  state.money += WAVE_CLEAR_BASE + WAVE_CLEAR_PER_WAVE * w;
  state.score += SCORE_WAVE_CLEAR * w;
  cue(CUES.waveClear);

  if (w >= figures.waveCount) {
    state.score += SCORE_VICTORY_PER_LIFE * state.lives;
    state.screen = "victory";
    state.menuIndex = 0;
    state.build = null;
    state.selected = null;
    cue(CUES.victory);
    return;
  }

  state.wave = w + 1;
  state.phase = "building";
  state.buildTimer = BUILD_PHASE_TIME;
  state.wavePending = 0;
  state.spawnClock = 0;
  if (figures.interest) {
    state.money += Math.min(
      Math.floor(INTEREST_RATE * state.money),
      INTEREST_CAP,
    );
  }
}
