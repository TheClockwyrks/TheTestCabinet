// Fathom — the fixed-step simulation.
//
// `specs/movement.md` fixes the tick as the game's whole clock: the simulation
// advances in whole `TICK_DT` steps and every rate in the specification is
// integrated in them, so the same starting state driven by the same inputs over
// the same elapsed game time reaches the same state every time. Nothing here
// reads the renderer, a canvas or the wall clock.
//
// One tick is `stepTick`, and the game mode's tick runs as many of them as the
// frame's delta completes. Everything the tick advances it writes onto the live
// `FathomState` in place; the cues it raises are collected into a bag and played
// once each at the end of the tick (`src/audio.ts`).

import type { CueBag } from "./audio";
import {
  CUES,
  DRIFTER_INTERVAL,
  DRIFTER_MAX,
  GLOAMFIN_PING_RANGE,
  INK_COOLDOWN,
  INK_LIFE,
  INK_RADIUS,
  SCORE_DRIFTER,
  SCORE_PLANKTON,
  SONAR_COOLDOWN,
  SONAR_MARK_TIME,
} from "./constants";
import { Drifter, wanderIntent } from "./creatures";
import type { Predator } from "./creatures";
import {
  applyReleaseSchedule,
  beginPlay,
  clearMaze,
  descend,
  drifterEntry,
  loseLife,
  sonarRange,
} from "./flow";
import type { Cell } from "./grid";
import { DIRS, cellIndex, sameCell } from "./grid";
import { advanceBody, bodyCell } from "./movement";
import type { Trench } from "./predators";
import { acquireFix, decayPredatorTimers, updatePredator } from "./predators";
import { SonarPulse } from "./sonar";
import type { PulseTint } from "./sonar";
import type { FathomState } from "./game";

/**
 * How far behind the leading edge a wavefront's crest still stands, in corridor
 * steps. It is what the front holds lit as it sweeps (`specs/sensing.md`: a
 * revealed tile is lit while its source holds it), and the band `src/render.ts`
 * draws the crest across.
 */
export const SONAR_CREST_TILES = 2.6;

/** Below this a timer has run out, whatever float residue it is carrying. */
const TIMER_FLOOR = 1e-6;

/**
 * A timer `dt` seconds further down, and exactly `0` once it has run out.
 *
 * The floor is what makes a whole number of seconds a whole number of ticks: a
 * cooldown stepped down by `TICK_DT` a hundred and eighty times lands a few
 * float ulps above zero rather than on it, and without the floor that residue
 * buys the cooldown one more tick than the specification gives it.
 */
function runDown(seconds: number, dt: number): number {
  const left = seconds - dt;
  return left <= TIMER_FLOOR ? 0 : left;
}

/** What the maze around a hunter offers it, bound to the live state. */
export function trenchFor(state: FathomState, cues: CueBag): Trench {
  return {
    maze: state.maze,
    forager: state.forager,
    clouds: state.inkClouds,
    rng: state.rng,
    ping: (predator, tint) => castPing(state, predator, tint, cues),
    // The alert's window and its flash both hang off the predator's own
    // `alert` timer, so an acquisition needs nothing further here.
    acquired: () => undefined,
    bloomed: () => cues.add(CUES.flare),
  };
}

/** The forager's own pulse, on the control in `specs/movement.md`. */
export function emitSonar(state: FathomState, cues: CueBag): void {
  if (state.sonarCooldown > 0) return;
  state.sonarCooldown = SONAR_COOLDOWN;
  state.pulses.push(
    new SonarPulse(
      state.maze,
      bodyCell(state.forager),
      sonarRange(state.depth),
      "forager",
      "cyan",
    ),
  );
  cues.add(CUES.sonar);
}

/** An ink cloud, released where the forager stands. */
export function releaseInk(state: FathomState, cues: CueBag): void {
  if (state.inkCooldown > 0) return;
  state.inkCooldown = INK_COOLDOWN;
  state.inkClouds.push({
    x: state.forager.x,
    y: state.forager.y,
    radius: INK_RADIUS,
    remaining: INK_LIFE,
  });
  cues.add(CUES.ink);
}

/** One of the Gloamfin's own pings, cast from the tile it stands on. */
function castPing(
  state: FathomState,
  predator: Predator,
  tint: PulseTint,
  cues: CueBag,
): void {
  const pulse = new SonarPulse(
    state.maze,
    bodyCell(predator),
    GLOAMFIN_PING_RANGE,
    "gloamfin",
    tint,
  );
  pulse.emitterIndex = state.predators.indexOf(predator);
  state.pulses.push(pulse);
  cues.add(CUES.predatorPing);
}

/** One tick of the whole game, whatever screen it is on. */
export function stepTick(state: FathomState, dt: number, cues: CueBag): void {
  // Accumulated simulation time runs on every screen, the menus and the paused
  // screen included (specs/state.md).
  state.simTime += dt;

  switch (state.screen) {
    case "countdown":
      // The countdown's own remaining time, and the light the forager casts on
      // the maze around it. Everything else holds still (specs/ui.md).
      state.countdown -= dt;
      refreshLight(state);
      if (state.countdown <= 0) beginPlay(state);
      return;
    case "playing":
      stepPlay(state, dt, cues);
      return;
    case "cleared":
      state.clearedTimer -= dt;
      if (state.clearedTimer <= 0) descend(state);
      return;
    default:
      return;
  }
}

function stepPlay(state: FathomState, dt: number, cues: CueBag): void {
  const trench = trenchFor(state, cues);

  state.sonarCooldown = runDown(state.sonarCooldown, dt);
  state.inkCooldown = runDown(state.inkCooldown, dt);
  state.forager.advanceLight(dt);

  state.playTime += dt;
  applyReleaseSchedule(state);

  advanceBody(
    state.forager,
    dt,
    state.maze,
    () => state.desired,
    state.maze.openToForager,
  );

  const cleared = eatPlankton(state, cues);

  stepInk(state, dt);

  for (const predator of state.predators) {
    decayPredatorTimers(predator, dt);
    if (predator.mind) updatePredator(predator, dt, trench);
  }

  stepDrifters(state, dt, cues);
  stepPulses(state, dt, trench);
  refreshLight(state);

  if (contact(state)) {
    cues.add(CUES.caught);
    loseLife(state);
    return;
  }

  if (cleared) {
    cues.add(CUES.descend);
    clearMaze(state);
  }
}

/**
 * The forager eats the plankton on its own tile the moment its center enters
 * that tile. Eating the one that leaves none behind clears the maze, which is
 * why clearing is reported from here rather than read off the count: a board
 * emptied any other way stays in live play (`specs/instrumentation.md`).
 */
function eatPlankton(state: FathomState, cues: CueBag): boolean {
  const cell = bodyCell(state.forager);
  const key = cellIndex(cell.tx, cell.ty);
  if (!state.plankton[key]) return false;
  state.plankton[key] = false;
  state.planktonRemaining -= 1;
  state.score += SCORE_PLANKTON;
  state.forager.graze();
  cues.add(CUES.eat);
  return state.planktonRemaining === 0;
}

function stepInk(state: FathomState, dt: number): void {
  for (const cloud of state.inkClouds) cloud.remaining -= dt;
  state.inkClouds = state.inkClouds.filter((cloud) => cloud.remaining > 0);
}

function stepDrifters(state: FathomState, dt: number, cues: CueBag): void {
  for (const drifter of state.drifters) {
    // Its wander is what its mind decides and the step is its travel, so with
    // either faculty off it holds the tile it stands on
    // (`specs/instrumentation.md`).
    if (!drifter.mind || !drifter.travel) continue;
    advanceBody(
      drifter,
      dt,
      state.maze,
      () =>
        wanderIntent(drifter, state.maze, state.rng, state.maze.openToForager),
      state.maze.openToForager,
    );
  }

  const here = bodyCell(state.forager);
  const left = state.drifters.filter(
    (drifter) => !sameCell(bodyCell(drifter), here),
  );
  const eaten = state.drifters.length - left.length;
  if (eaten > 0) {
    state.drifters = left;
    state.score += SCORE_DRIFTER * eaten;
    cues.add(CUES.eat);
  }

  // The cadence tops the maze up to its ceiling and stops there, so the timer
  // runs only while there is room for another (`specs/gameplay.md`).
  if (state.drifters.length >= DRIFTER_MAX) return;
  state.drifterTimer -= dt;
  if (state.drifterTimer > 0 || state.planktonRemaining === 0) return;
  state.drifterTimer = DRIFTER_INTERVAL;
  const entry = drifterEntry(state);
  if (entry !== null) state.drifters.push(new Drifter(entry));
}

/**
 * Advances every wavefront in flight and applies what its front just swept
 * over. The forager's pulse reveals the corridors it crosses and the rock
 * bounding them, marks the hunters a pulse marks, and hands a Gloamfin it
 * reaches a fix; a Gloamfin's ping reveals nothing and catches the forager at
 * most once (`specs/sensing.md`, `specs/predators/gloamfin.md`).
 */
function stepPulses(state: FathomState, dt: number, trench: Trench): void {
  const here = bodyCell(state.forager);
  for (const pulse of state.pulses) {
    const crossed = pulse.advance(dt);
    if (crossed.length === 0) continue;
    const reached = new Set<number>();
    for (const bucket of crossed) {
      for (const cell of bucket) reached.add(cellIndex(cell.tx, cell.ty));
    }

    if (pulse.source !== "forager") {
      if (pulse.caughtForager) continue;
      if (!reached.has(cellIndex(here.tx, here.ty))) continue;
      pulse.caughtForager = true;
      const emitter =
        pulse.emitterIndex === null
          ? undefined
          : state.predators[pulse.emitterIndex];
      // Taking the fix is the Gloamfin's own decision, so a scenario that has
      // turned its mind off gets the wavefront without it.
      if (emitter && emitter.mind && emitter.state !== "den") {
        acquireFix(emitter, trench, here);
      }
      continue;
    }

    for (const bucket of crossed) {
      for (const cell of bucket) revealWithWalls(state, cell);
    }
    for (const predator of state.predators) {
      if (predator.state === "den") continue;
      const cell = bodyCell(predator);
      if (!reached.has(cellIndex(cell.tx, cell.ty))) continue;
      // A pulse leaves the amber lights as they are, so it never marks the
      // Lanternjaw and never resolves which glimmer is which.
      if (predator.kind === "lanternjaw") continue;
      predator.mark = SONAR_MARK_TIME;
      if (predator.kind === "gloamfin" && predator.mind) {
        acquireFix(predator, trench, here);
      }
    }
  }
  state.pulses = state.pulses.filter((pulse) => !pulse.spent);
}

/** A flooded corridor tile, remembered together with the rock bounding it. */
function revealWithWalls(state: FathomState, cell: Cell): void {
  state.fog.reveal(cell.tx, cell.ty);
  for (const dir of DIRS) {
    const side = state.maze.step(cell.tx, cell.ty, dir);
    if (state.maze.isRock(side.tx, side.ty)) state.fog.reveal(side.tx, side.ty);
  }
}

/**
 * Rebuilds the lit set from whatever is shining this instant: the forager's own
 * line-of-sight pocket, the disc of every burning flare, and the crest of every
 * forager pulse still sweeping the corridors. Memory is not touched, so a tile
 * a source has left drops from lit back to remembered.
 */
export function refreshLight(state: FathomState): void {
  const { fog, maze } = state;
  fog.clearLit();
  fog.lightPocket(
    maze,
    state.forager.x,
    state.forager.y,
    state.forager.visionRadius,
  );

  for (const predator of state.predators) {
    if (!predator.flaring || predator.flareRadius <= 0) continue;
    fog.lightDisc(predator.x, predator.y, predator.flareRadius);
  }

  for (const pulse of state.pulses) {
    if (pulse.source !== "forager") continue;
    const furthest = Math.min(
      pulse.buckets.length - 1,
      Math.floor(pulse.front),
    );
    const nearest = Math.max(0, Math.ceil(pulse.front - SONAR_CREST_TILES));
    for (let step = nearest; step <= furthest; step++) {
      for (const cell of pulse.buckets[step]) {
        fog.flash(cell.tx, cell.ty);
        for (const dir of DIRS) {
          const side = maze.step(cell.tx, cell.ty, dir);
          if (maze.isRock(side.tx, side.ty)) fog.flash(side.tx, side.ty);
        }
      }
    }
  }
}

/**
 * Contact: a predator out of the den whose center lies on the forager's own
 * tile, whatever its kind and whatever it is doing (`specs/gameplay.md`).
 */
export function contact(state: FathomState): boolean {
  const here = bodyCell(state.forager);
  return state.predators.some(
    (predator) =>
      predator.state !== "den" && sameCell(bodyCell(predator), here),
  );
}

/** Whether a body is one the fog is currently drawing. */
export function predatorDrawn(state: FathomState, predator: Predator): boolean {
  if (predator.state === "den") return false;
  if (predator.alert > 0 || predator.mark > 0) return true;
  const cell = bodyCell(predator);
  return state.fog.showsBody(cell.tx, cell.ty);
}

/**
 * Whether a drifter's body is drawn this instant: by the forager's own light, or
 * inside a flare's disc. Its amber mote is drawn under the amber-light rule and
 * is a different question, so a drifter glimmering in the dark is one whose body
 * is not drawn.
 */
export function drifterDrawn(state: FathomState, drifter: Drifter): boolean {
  const cell = bodyCell(drifter);
  return state.fog.showsBody(cell.tx, cell.ty);
}
