// Fathom — the fixed-step simulation (`specs/movement.md`).
//
// The engine hands each frame a delta time in seconds; the simulation advances by
// the whole `TICK_DT` ticks that delta completes and carries the remainder into
// the next frame, so the number of ticks run over an interval of game time is the
// same however that interval was divided into frames. The tick is the game's
// whole clock: movement, cooldowns, timers and the creatures' decisions all
// advance inside it.
//
// Everything here is a transition. A tick takes the current state and returns the
// next one beside the cues it raised, and the caller — `update` — is the only
// thing that plays them, because a frame's audible behavior is decided by the
// same function that advanced the simulation.

import {
  BRIGHT_HALFLIFE,
  BRIGHT_PER_EAT,
  BRIGHT_HOLD,
  CUES,
  DRIFTER_INTERVAL,
  DRIFTER_MAX,
  DRIFTER_SPEED,
  FLARE_RADIUS,
  FORAGER_SPEED,
  SCORE_DRIFTER,
  SCORE_PLANKTON,
  SONAR_MARK_TIME,
  TICK_DT,
  type CueName,
} from "./constants";
import { DIRS, centerX, centerY, tileIndex } from "./grid";
import { bodyTile, driftBody, moveBody } from "./entities";
import { beginLivePlay, clearMaze, descend, loseLife } from "./flow";
import { ageInk } from "./ink";
import { foragerCanEnter, isRock, stepTile } from "./maze";
import {
  acquireFix,
  coolPredator,
  flaring,
  stepPredator,
  type Bloom,
  type PredatorWorld,
} from "./predators";
import { createDraws } from "./rng";
import { castLight, lightDisc, visionRadius } from "./sensing";
import { advancePulse, pulseSpent } from "./sonar";
import type {
  DrifterState,
  FathomState,
  ForagerState,
  PredatorState,
  PulseState,
  Tile,
} from "./state";

/** Below this the brightness is spent, and reporting it as `0` is honest. */
const BRIGHT_FLOOR = 0.001;

/**
 * Below this a cooldown has run out. A timer counted down one tick at a time
 * lands a hair either side of zero rather than on it, and a pulse that reports
 * itself unready because of a millionth of a second is simply wrong.
 */
const COOLDOWN_FLOOR = 1e-6;

/** What one tick left behind. */
export interface TickResult {
  readonly state: FathomState;
  /** The cues this tick raised, each at most once. */
  readonly cues: readonly CueName[];
}

// ---- The forager ---------------------------------------------------------

/** The forager after one tick of travel (`specs/movement.md`). */
function travelForager(state: FathomState, dt: number): ForagerState {
  const f = state.forager;
  // It travels while a movement action is held and comes to rest where it stands
  // when none is: the desired direction outlives the key, the motion does not.
  if (state.heldDirs.length === 0) return { ...f, heading: null };
  const canEnter = (tx: number, ty: number): boolean =>
    foragerCanEnter(state.maze, tx, ty);
  const moved = moveBody(f, {
    maze: state.maze,
    speed: FORAGER_SPEED,
    dt,
    canEnter,
    request: f.desired,
    // At every tile center it asks for the desired direction again, so a turn
    // set slightly before a junction is taken at the junction.
    decide: () => f.desired,
  });
  return { ...f, ...moved };
}

/** A timer `dt` seconds further down, and exactly `0` once it has run out. */
function runDown(seconds: number, dt: number): number {
  const left = seconds - dt;
  return left <= COOLDOWN_FLOOR ? 0 : left;
}

/** The cooldowns and the brightness after one tick (`specs/sensing.md`). */
function coolDown(state: FathomState, dt: number): FathomState {
  const held = state.brightHold > 0;
  // While the hold runs `G` is steady; past it, it halves every BRIGHT_HALFLIFE.
  const decayed = state.brightness * Math.pow(0.5, dt / BRIGHT_HALFLIFE);
  return {
    ...state,
    sonarCooldown: runDown(state.sonarCooldown, dt),
    inkCooldown: runDown(state.inkCooldown, dt),
    brightHold: runDown(state.brightHold, dt),
    brightness: held ? state.brightness : decayed < BRIGHT_FLOOR ? 0 : decayed,
  };
}

/** What grazing the forager's own tile left behind. */
interface Graze {
  readonly state: FathomState;
  readonly ate: boolean;
  /** Whether that mouthful was the one that left none behind. */
  readonly cleared: boolean;
}

/**
 * The plankton on the forager's tile, eaten the moment its center enters that
 * tile (`specs/gameplay.md`). Eating the plankton that leaves none behind clears
 * the maze.
 */
function grazePlankton(state: FathomState): Graze {
  const tile = bodyTile(state.forager);
  const index = tileIndex(tile.tx, tile.ty);
  if (!state.plankton[index]) return { state, ate: false, cleared: false };

  const plankton = [...state.plankton];
  plankton[index] = false;
  const planktonRemaining = state.planktonRemaining - 1;
  return {
    state: {
      ...state,
      plankton,
      planktonRemaining,
      score: state.score + SCORE_PLANKTON,
      brightness: Math.min(1, state.brightness + BRIGHT_PER_EAT),
      brightHold: BRIGHT_HOLD,
    },
    ate: true,
    cleared: planktonRemaining <= 0,
  };
}

// ---- The creatures -------------------------------------------------------

/** What one tick of the creatures' own minds left behind. */
interface CreatureStep {
  readonly predators: readonly PredatorState[];
  readonly drifters: readonly DrifterState[];
  readonly pulses: readonly PulseState[];
  readonly blooms: readonly Bloom[];
  readonly cues: readonly CueName[];
  readonly rngState: number;
}

/**
 * Every predator and every drifter after one tick.
 *
 * Each creature runs its own mind, and one whose mind is off holds exactly where
 * it stands, keeping the tile, facing and state it was posed with, while only the
 * windows that are consequences rather than decisions run down. A creature whose
 * travel is off runs its mind in full and holds its body on the tile it stands on
 * (`specs/instrumentation.md`). A faculty is turned off one creature at a time,
 * so every other creature carries on untouched.
 */
function stepCreatures(state: FathomState, dt: number): CreatureStep {
  const draws = createDraws(state.rngState);
  const forager = bodyTile(state.forager);
  const world: PredatorWorld = {
    maze: state.maze,
    fx: state.forager.x,
    fy: state.forager.y,
    ftx: forager.tx,
    fty: forager.ty,
    brightness: state.brightness,
    inkClouds: state.inkClouds,
  };

  const predators: PredatorState[] = [];
  const pulses: PulseState[] = [];
  const blooms: Bloom[] = [];
  const cues: CueName[] = [];
  state.predators.forEach((p, index) => {
    if (!p.mind) {
      predators.push(coolPredator(p, dt));
      return;
    }
    const step = stepPredator(p, index, dt, world, draws);
    predators.push(step.predator);
    pulses.push(...step.pulses);
    cues.push(...step.cues);
    if (step.bloom !== null) blooms.push(step.bloom);
  });

  const drifters = state.drifters.map((d) => {
    // A drifter's wander is its mind and its travel is what carries that wander
    // through the maze, so one whose travel is off rests where it stands.
    if (!d.travel) return { ...d, heading: null };
    if (!d.mind) return d;
    return { ...d, ...driftBody(d, state.maze, DRIFTER_SPEED, dt, draws) };
  });

  return { predators, drifters, pulses, blooms, cues, rngState: draws.state };
}

/**
 * The drifters the forager ate this tick, and the score they paid
 * (`specs/gameplay.md`). Eating a drifter is the forager's doing rather than the
 * drifter's, so a drifter whose mind is off is still eaten and still scores.
 */
function grazeDrifters(state: FathomState): FathomState {
  const tile = bodyTile(state.forager);
  const left = state.drifters.filter((d) => {
    const at = bodyTile(d);
    return at.tx !== tile.tx || at.ty !== tile.ty;
  });
  const eaten = state.drifters.length - left.length;
  if (eaten === 0) return state;
  return {
    ...state,
    drifters: left,
    score: state.score + SCORE_DRIFTER * eaten,
  };
}

/**
 * The bonus-drifter cadence (`specs/gameplay.md`): while plankton remain the maze
 * is topped up to `DRIFTER_MAX` at the den gate, about every `DRIFTER_INTERVAL`.
 */
function admitDrifter(state: FathomState, dt: number): FathomState {
  // The cadence runs only while there is room and while plankton remain, so a
  // freed slot refills after a fresh interval rather than instantly and a bare
  // maze does not bank one up.
  if (state.drifters.length >= DRIFTER_MAX || state.planktonRemaining <= 0) {
    return state;
  }
  const drifterIn = state.drifterIn - dt;
  if (drifterIn > 0) return { ...state, drifterIn };
  const gate = state.maze.gate;
  // With no den gate a posed board has nowhere to admit a drifter from, so it
  // admits none (`specs/instrumentation.md`).
  if (gate === null) return { ...state, drifterIn: DRIFTER_INTERVAL };
  return {
    ...state,
    drifterIn: DRIFTER_INTERVAL,
    drifters: [...state.drifters, createDrifter(gate.tx, gate.ty - 1)],
  };
}

/**
 * A bonus drifter at rest on the center of `(tx, ty)`, its mind and its travel
 * running.
 */
export function createDrifter(tx: number, ty: number): DrifterState {
  return {
    x: centerX(tx),
    y: centerY(ty),
    facing: "down",
    heading: null,
    mind: true,
    travel: true,
  };
}

// ---- The wavefronts ------------------------------------------------------

/** What one tick of the wavefronts left behind. */
interface PulseStepResult {
  readonly pulses: readonly PulseState[];
  readonly predators: readonly PredatorState[];
  readonly revealed: readonly boolean[];
}

/**
 * Every wavefront after one tick, with what its front swept over applied
 * (`specs/sensing.md`).
 *
 * The forager's pulse reveals each open tile the front reaches together with the
 * rock bounding it, marks the Gloamfin and the Flarefish standing on it, and
 * hands a Gloamfin a fix. A Gloamfin's ping reveals nothing and marks nothing: it
 * carries the sound out, and catches the forager once, when its front arrives.
 */
function stepPulses(state: FathomState, dt: number): PulseStepResult {
  const forager = bodyTile(state.forager);
  let predators = state.predators;
  const revealed = [...state.revealed];
  const pulses: PulseState[] = [];

  for (const live of state.pulses) {
    const step = advancePulse(live, dt);
    let pulse = step.pulse;
    if (step.crossed.length > 0) {
      if (pulse.source === "forager") {
        revealFlood(state, revealed, step.crossed);
        predators = markSwept(predators, step.crossed, forager);
      } else if (!pulse.caughtForager && caught(step.crossed, forager)) {
        pulse = { ...pulse, caughtForager: true };
        predators = heardBy(predators, pulse.emitter, forager);
      }
    }
    if (!pulseSpent(pulse)) pulses.push(pulse);
  }

  return { pulses, predators, revealed };
}

/** Every tile the front reached, and the rock bounding those corridors. */
function revealFlood(
  state: FathomState,
  revealed: boolean[],
  crossed: readonly Tile[],
): void {
  for (const tile of crossed) {
    revealed[tileIndex(tile.tx, tile.ty)] = true;
    for (const dir of DIRS) {
      const side = stepTile(state.maze, tile.tx, tile.ty, dir);
      if (isRock(state.maze, side.tx, side.ty)) {
        revealed[tileIndex(side.tx, side.ty)] = true;
      }
    }
  }
}

function caught(crossed: readonly Tile[], forager: Tile): boolean {
  return crossed.some(
    (tile) => tile.tx === forager.tx && tile.ty === forager.ty,
  );
}

/**
 * The predators the forager's front swept over this tick: the Gloamfin and the
 * Flarefish are marked, and a Gloamfin also hears the pulse and takes a fix. The
 * Lanternjaw is an amber-light hunter and a pulse leaves it exactly as it was.
 */
function markSwept(
  predators: readonly PredatorState[],
  crossed: readonly Tile[],
  forager: Tile,
): readonly PredatorState[] {
  return predators.map((p) => {
    if (p.mode === "den" || p.kind === "lanternjaw") return p;
    const at = bodyTile(p);
    if (!caught(crossed, at)) return p;
    // The mark is what the pulse draws on the predator, so it lands whether or
    // not that predator is deciding anything; the fix is a decision, so a
    // predator whose mind is off takes none.
    const marked = { ...p, markIn: Math.max(p.markIn, SONAR_MARK_TIME) };
    if (p.kind !== "gloamfin" || !p.mind) return marked;
    return acquireFix(marked, forager.tx, forager.ty);
  });
}

/** The Gloamfin whose own ping's front has just reached the forager. */
function heardBy(
  predators: readonly PredatorState[],
  emitter: number | null,
  forager: Tile,
): readonly PredatorState[] {
  if (emitter === null) return predators;
  return predators.map((p, index) =>
    index === emitter && p.mode !== "den" && p.mind
      ? acquireFix(p, forager.tx, forager.ty)
      : p,
  );
}

// ---- The fog -------------------------------------------------------------

/**
 * The fog recomputed from scratch (`specs/sensing.md`): the forager's own light
 * pocket, then every burning bloom's disc, then which predators that leaves drawn.
 *
 * What is lit is whatever a source holds this instant, so it is rebuilt rather
 * than accumulated; what has ever been revealed is remembered for the rest of the
 * maze.
 */
function recomputeFog(
  state: FathomState,
  blooms: readonly Bloom[],
): FathomState {
  const cast = castLight(
    state.maze,
    state.revealed,
    state.forager.x,
    state.forager.y,
    visionRadius(state.brightness),
  );
  const revealed = [...cast.revealed];
  const lit = [...cast.lit];
  for (const bloom of blooms) {
    lightDisc(revealed, lit, bloom.x, bloom.y, bloom.radius);
  }
  const predators = state.predators.map((p) => ({
    ...p,
    lit: predatorLit(p, lit),
  }));
  return { ...state, revealed, lit, predators };
}

/**
 * Whether a predator's body is drawn this instant: by the forager's light, by a
 * live sonar mark, by a flare, or by its own detection alert
 * (`specs/predators.md`). One held in the den is drawn nowhere.
 */
function predatorLit(p: PredatorState, lit: readonly boolean[]): boolean {
  if (p.mode === "den") return false;
  const at = bodyTile(p);
  return lit[tileIndex(at.tx, at.ty)] || p.alertIn > 0 || p.markIn > 0;
}

/** The blooms burning this instant, read back off the predators. */
function blooming(predators: readonly PredatorState[]): Bloom[] {
  const blooms: Bloom[] = [];
  for (const p of predators) {
    if (p.mode === "den" || !flaring(p)) continue;
    blooms.push({ x: p.x, y: p.y, radius: FLARE_RADIUS });
  }
  return blooms;
}

// ---- Contact -------------------------------------------------------------

/**
 * Whether a predator's center lies on the forager's own tile
 * (`specs/gameplay.md`). A predator held in the den is out of play and touches
 * nobody.
 */
function touched(state: FathomState): boolean {
  const forager = bodyTile(state.forager);
  return state.predators.some((p) => {
    if (p.mode === "den") return false;
    const at = bodyTile(p);
    return at.tx === forager.tx && at.ty === forager.ty;
  });
}

// ---- One tick ------------------------------------------------------------

/** One tick of live play. */
function playTick(state: FathomState, dt: number): TickResult {
  const cues = new Set<CueName>();
  let next = coolDown(state, dt);
  next = { ...next, forager: travelForager(next, dt) };

  const grazed = grazePlankton(next);
  next = grazed.state;
  if (grazed.ate) cues.add(CUES.eat);
  if (grazed.cleared) {
    cues.add(CUES.descend);
    return { state: clearMaze(next), cues: [...cues] };
  }

  next = { ...next, inkClouds: ageInk(next.inkClouds, dt) };

  const creatures = stepCreatures(next, dt);
  for (const cue of creatures.cues) cues.add(cue);
  next = {
    ...next,
    predators: creatures.predators,
    drifters: creatures.drifters,
    rngState: creatures.rngState,
    // A ping cast this tick joins the wavefronts before they travel, so it
    // leaves the Gloamfin's tile on the tick it was cast.
    pulses: [...next.pulses, ...creatures.pulses],
  };

  const swept = stepPulses(next, dt);
  next = {
    ...next,
    pulses: swept.pulses,
    predators: swept.predators,
    revealed: swept.revealed,
  };

  next = recomputeFog(next, blooming(next.predators));
  next = admitDrifter(grazeDrifters(next), dt);

  if (touched(next)) {
    cues.add(CUES.caught);
    return { state: loseLife(next), cues: [...cues] };
  }
  return { state: next, cues: [...cues] };
}

/**
 * One tick of the whole game.
 *
 * `simTime` accumulates on every screen, the menus and the paused screen
 * included. What else advances is the screen's own (`specs/ui.md`).
 */
export function tick(state: FathomState, dt: number): TickResult {
  const timed: FathomState = { ...state, simTime: state.simTime + dt };
  switch (timed.screen) {
    case "countdown": {
      // The countdown's own remaining time, and the light the forager casts on
      // the maze around it. Everything else holds still.
      const lit = recomputeFog(timed, blooming(timed.predators));
      const screenIn = lit.screenIn - dt;
      return {
        state: screenIn <= 0 ? beginLivePlay(lit) : { ...lit, screenIn },
        cues: [],
      };
    }
    case "cleared": {
      const screenIn = timed.screenIn - dt;
      return {
        state: screenIn <= 0 ? descend(timed) : { ...timed, screenIn },
        cues: [],
      };
    }
    case "playing":
      return playTick(timed, dt);
    default:
      return { state: timed, cues: [] };
  }
}

/**
 * The state after a frame worth `dt` seconds of elapsed time, and the cues those
 * ticks raised in order.
 *
 * The frame advances the whole `TICK_DT` ticks its delta completes and carries
 * the remainder, so the same interval of game time reaches the same state however
 * it was divided into frames. How much one frame's delta may be worth is the
 * clock's to bound, not the simulation's: the engine's own wall clock clamps a
 * stalled frame, and a scripted one is asked for exactly what it delivers.
 */
export function advanceFrame(
  state: FathomState,
  dt: number,
): { readonly state: FathomState; readonly cues: readonly CueName[] } {
  let next = state;
  const cues: CueName[] = [];
  let carry = state.carry + Math.max(0, dt);
  while (carry >= TICK_DT) {
    carry -= TICK_DT;
    const stepped = tick(next, TICK_DT);
    next = stepped.state;
    cues.push(...stepped.cues);
  }
  return { state: { ...next, carry }, cues };
}
