// Floe — the game itself: the rules, the run, and the screens.
//
// One tick is the whole clock (specs/overview.md), so everything that happens in
// Floe happens in `stepTick` below, in the order this file fixes: the screen and
// its menu first, then the strait, then the crossing on it. Nothing here draws
// and nothing here reads the wall clock, which is what lets the same starting
// state driven by the same inputs over the same elapsed game time reach the same
// state every time.
//
// The authoritative game is the world the engine owns (`specs/state.md`): the
// run's figures on `FloeState`, the strait's bodies as tagged actors. This file
// writes both, and it is the only thing that advances them: the actors carry no
// tick of their own, because a tick of theirs would run against the frame's
// delta rather than against the fixed step. The debug surface
// (`src/debug.ts`) poses the same fields these rules read and then lets them run
// from there, so a scenario driven from code behaves exactly like one played by
// hand.

import type { World } from "@test-cabinet/structured-2d";
import {
  BAYFILL_PAUSE,
  BAY_COUNT,
  BEAR_CATCH_DIST,
  BEAR_EMERGE_ADVANCE,
  BEAR_EMERGE_DELAY,
  BEAR_SECOND_ADVANCE,
  BEAR_SECOND_DELAY,
  BONUS_LIFE_EVERY,
  CLEAR_PAUSE,
  CUES,
  DEATH_PAUSE,
  DEFAULT_SEED,
  ENDING_ITEMS,
  FISH_INTERVAL,
  FISH_LINGER,
  HOP_COOLDOWN,
  PAUSE_ITEMS,
  ROW_BAYS,
  ROW_CAP,
  ROW_NEAR,
  SCORE_BAY,
  SCORE_BONUS_CATCH,
  SCORE_LEVEL,
  SCORE_ROW,
  SCORE_TIME_BONUS,
  SCORE_VICTORY_LIFE,
  START_LIVES,
  STRAIT_W,
  TILE,
  TITLE_ITEMS,
  TOTAL_LEVELS,
  colAt,
  crossingTimer,
  inBounds,
  rowAt,
  tileCX,
  tileCY,
  type CueName,
} from "./constants";
import type { Bear } from "./bodies";
import { bearsOf, critterOf, floesOf, vehiclesOf } from "./bodies";
import {
  critterCol,
  critterFooting,
  critterRow,
  dropAllBears,
  dropBear,
  freshCritter,
  freshSlots,
  placeCenter,
  spawnBear,
  syncFish,
} from "./entities";
import {
  bayIndexAtCol,
  facingDX,
  facingDY,
  isWaterRow,
  rowsAdvanced,
} from "./grid";
import {
  advanceLanes,
  floeAtPoint,
  laneAt,
  layoutLevel,
  vehicleAtPoint,
  vehicleOnTile,
} from "./lanes";
import {
  bearSwimming,
  chooseStep,
  commitStep,
  isSettled,
  travelBear,
} from "./hunter";
import { pick } from "./rng";
import type { Death, Facing, FloeState } from "./game";

/**
 * What one tick may reach outside the world: the cue bus and the runtime's mute
 * bit. Structural, so the rules can be driven with a bus of the caller's own.
 */
export interface Bus {
  /** Raise a declared cue. */
  cue(name: CueName): void;
  /** Whether the runtime is muted. */
  muted(): boolean;
  /** Mute or unmute the runtime. */
  setMuted(muted: boolean): void;
}

/** The tick's input, resolved out of the actions before the rules see it. */
export interface Intents {
  /** The direction being requested on the `playing` screen, or `null`. */
  held: Facing | null;
  /** Menu movement edges. */
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** The other four, each an edge. */
  confirm: boolean;
  back: boolean;
  pause: boolean;
  mute: boolean;
}

/** No key at all: what a tick driven with nothing held is given. */
export function noIntents(): Intents {
  return {
    held: null,
    up: false,
    down: false,
    left: false,
    right: false,
    confirm: false,
    back: false,
    pause: false,
    mute: false,
  };
}

/**
 * The direction the critter is being asked to hop in, or `null`.
 *
 * A held direction is the normal reading (`specs/controls.md`), and a movement
 * edge stands in for one on the tick it arrives: a press and release that both
 * land between two ticks would otherwise be a request no tick ever saw, and
 * `specs/hopping.md` requires a press released inside the cooldown to produce
 * exactly one hop. The edge is cleared by the tick that read it, so it asks for
 * one hop and no more.
 */
export function requested(intents: Intents): Facing | null {
  if (intents.held !== null) return intents.held;
  if (intents.up) return "up";
  if (intents.down) return "down";
  if (intents.left) return "left";
  if (intents.right) return "right";
  return null;
}

/** Take the edges out of an intents record, leaving the held direction. */
export function clearEdges(intents: Intents): void {
  intents.up = false;
  intents.down = false;
  intents.left = false;
  intents.right = false;
  intents.confirm = false;
  intents.back = false;
  intents.pause = false;
  intents.mute = false;
}

// ---- Resetting and starting ---------------------------------------------

/** Five open bays. */
function openBays(): boolean[] {
  return Array.from({ length: BAY_COUNT }, () => false);
}

/**
 * Restore every field to its title-screen value and reseed the generator
 * (specs/instrumentation.md).
 *
 * `muted` is deliberately untouched, and it could not be touched from here in
 * any case: the mute bit is the engine's own and a reset is not a reason to start
 * making noise again.
 */
export function resetGame(
  world: World,
  state: FloeState,
  seed = DEFAULT_SEED,
): void {
  state.screen = "title";
  state.menuIndex = 0;
  state.phase = "crossing";
  state.phaseTimer = 0;
  state.level = 1;
  state.reachedLevel = 1;
  state.lives = START_LIVES;
  state.score = 0;
  state.timer = crossingTimer(1);
  state.bays = openBays();
  state.fishBay = null;
  state.fishTimer = FISH_INTERVAL;
  state.lastFishBay = null;
  state.bearEmergence = true;
  state.catchTest = true;
  state.fishCadence = true;
  state.timerRunning = true;
  state.simTime = 0;
  state.rngState = seed;
  state.nextId = 1;
  state.effects = [];
  state.slots = freshSlots(1);
  state.accumulator = 0;
  clearEdges(state.intents);
  state.intents.held = null;

  dropAllBears(world, state);
  layoutLevel(world, state, 1);
  syncFish(world, state);

  const critter = critterOf(world);
  freshCritter(critter);
  critter.present = false;
}

/** Open a run at level 1 with a fresh crossing (specs/progression.md). */
export function startRun(world: World, state: FloeState): void {
  state.level = 1;
  state.reachedLevel = 1;
  state.lives = START_LIVES;
  state.score = 0;
  state.bays = openBays();
  state.fishBay = null;
  state.fishTimer = FISH_INTERVAL;
  state.lastFishBay = null;
  state.effects = [];
  layoutLevel(world, state, 1);
  state.screen = "playing";
  beginCrossing(world, state);
}

/** Put a fresh critter on the near shore and start its timer over. */
export function beginCrossing(world: World, state: FloeState): void {
  freshCritter(critterOf(world));
  state.timer = crossingTimer(state.level);
  state.phase = "crossing";
  state.phaseTimer = 0;
  state.slots = freshSlots(state.level);
  dropAllBears(world, state);
}

/** Lay the strait out for a level and open every bay (specs/progression.md). */
function openLevel(world: World, state: FloeState, level: number): void {
  state.level = level;
  state.reachedLevel = Math.max(state.reachedLevel, level);
  state.bays = openBays();
  state.fishBay = null;
  state.fishTimer = FISH_INTERVAL;
  state.lastFishBay = null;
  layoutLevel(world, state, level);
}

// ---- Scoring -------------------------------------------------------------

/**
 * Add to the score, awarding a bonus life for every `BONUS_LIFE_EVERY` boundary
 * the score crosses (specs/progression.md).
 *
 * Every award in the game runs through here, and a POSED score does not: a pose
 * is a precondition, and the award belongs to the scoring path.
 */
export function addScore(state: FloeState, points: number, bus: Bus): void {
  const before = Math.floor(state.score / BONUS_LIFE_EVERY);
  state.score += points;
  const earned = Math.floor(state.score / BONUS_LIFE_EVERY) - before;
  if (earned > 0) {
    state.lives += earned;
    bus.cue(CUES.bonusLife);
  }
}

// ---- Losing a life -------------------------------------------------------

/** The cue each death sounds; the timer running out sounds none. */
const DEATH_CUE: Record<Death, CueName | null> = {
  crush: CUES.crush,
  splash: CUES.splash,
  caught: CUES.caught,
  timeout: null,
};

/**
 * Take a life (specs/progression.md).
 *
 * The critter leaves the strait for the whole of the hold, so nothing on the
 * strait can reach it and no second life is lost, and every bear leaves with it.
 */
export function loseLife(
  world: World,
  state: FloeState,
  cause: Death,
  bus: Bus,
): void {
  const critter = critterOf(world);
  state.lives -= 1;
  state.phase = "dying";
  state.phaseTimer = DEATH_PAUSE;
  critter.present = false;
  dropAllBears(world, state);
  const cue = DEATH_CUE[cause];
  if (cue !== null) bus.cue(cue);
  state.effects.push({
    kind: cause === "crush" ? "spray" : "splash",
    x: critter.transform.x,
    y: critter.transform.y,
    life: DEATH_PAUSE,
    span: DEATH_PAUSE,
  });
}

// ---- The hop -------------------------------------------------------------

/** Whether a hop onto a tile is refused (specs/hopping.md). */
export function hopRefused(
  world: World,
  state: FloeState,
  col: number,
  row: number,
): boolean {
  if (!inBounds(col, row)) return true;
  if (row === ROW_CAP) return true;
  if (row === ROW_BAYS) {
    const bay = bayIndexAtCol(col);
    if (bay < 0 || state.bays[bay]) return true;
  }
  return vehicleOnTile(world, col, row) !== null;
}

/** Take one hop, if the rules accept it. Returns whether the critter moved. */
export function tryHop(
  world: World,
  state: FloeState,
  facing: Facing,
  bus: Bus,
): boolean {
  const critter = critterOf(world);
  const col = colAt(critter.transform.x) + facingDX(facing);
  const row = rowAt(critter.transform.y) + facingDY(facing);
  if (hopRefused(world, state, col, row)) return false;

  placeCenter(critter, tileCX(col), tileCY(row));
  critter.facing = facing;
  critter.hopCooldown = HOP_COOLDOWN;
  bus.cue(CUES.hop);

  if (row < critter.bestRow) {
    critter.bestRow = row;
    addScore(state, SCORE_ROW, bus);
  }
  if (row === ROW_BAYS) fillBay(world, state, bayIndexAtCol(col), bus);
  return true;
}

/**
 * End a crossing in a bay (specs/bays.md, specs/scoring.md).
 *
 * A level clears on THIS transition rather than on the count of filled bays, so
 * a strait whose bays were posed filled is a level still being played.
 */
function fillBay(world: World, state: FloeState, bay: number, bus: Bus): void {
  state.bays[bay] = true;
  critterOf(world).present = false;
  dropAllBears(world, state);
  bus.cue(CUES.bay);

  addScore(state, SCORE_BAY, bus);
  addScore(state, SCORE_TIME_BONUS * Math.floor(state.timer), bus);
  if (state.fishBay === bay) {
    state.fishBay = null;
    state.lastFishBay = bay;
    state.fishTimer = FISH_INTERVAL;
    addScore(state, SCORE_BONUS_CATCH, bus);
  }

  if (state.bays.some((filled) => !filled)) {
    state.phase = "crossing";
    state.phaseTimer = BAYFILL_PAUSE;
    return;
  }

  addScore(state, SCORE_LEVEL * state.level, bus);
  if (state.level >= TOTAL_LEVELS) {
    addScore(state, SCORE_VICTORY_LIFE * state.lives, bus);
    state.screen = "victory";
    state.menuIndex = 0;
    state.phase = "crossing";
    state.phaseTimer = 0;
    bus.cue(CUES.victory);
    return;
  }
  state.phase = "clearing";
  state.phaseTimer = CLEAR_PAUSE;
  bus.cue(CUES.levelClear);
}

// ---- The screens ---------------------------------------------------------

/** How many items the current screen's menu carries. */
export function menuLength(state: FloeState): number {
  switch (state.screen) {
    case "title":
      return TITLE_ITEMS.length;
    case "paused":
      return PAUSE_ITEMS.length;
    case "victory":
    case "gameover":
      return ENDING_ITEMS.length;
    default:
      return 0;
  }
}

/**
 * Move the highlight, if a movement edge arrived.
 *
 * Up is applied before down and movement before confirm (specs/ui.md), so a tick
 * carrying both an up edge and a down edge moves up only, and a tick carrying a
 * movement edge and a confirm edge moves only.
 */
function moveMenu(state: FloeState, intents: Intents, bus: Bus): boolean {
  const count = menuLength(state);
  if (count === 0) return false;
  const back = intents.up || intents.left;
  const forward = intents.down || intents.right;
  if (!back && !forward) return false;
  const step = back ? -1 : 1;
  state.menuIndex = (state.menuIndex + step + count) % count;
  bus.cue(CUES.menu);
  return true;
}

/** Return to the title screen, leaving the strait where it stands. */
function toTitle(state: FloeState): void {
  state.screen = "title";
  state.menuIndex = 0;
}

/** Everything a screen does with the tick's edges. */
function stepScreen(
  world: World,
  state: FloeState,
  intents: Intents,
  bus: Bus,
): void {
  if (intents.mute) bus.setMuted(!bus.muted());

  if (state.screen === "playing") {
    // `Escape` drives both pause and back; on this screen it pauses.
    if (intents.pause) {
      state.screen = "paused";
      state.menuIndex = 0;
    }
    return;
  }

  const moved = moveMenu(state, intents, bus);

  if (state.screen === "howto") {
    if (intents.back || intents.confirm) toTitle(state);
    return;
  }
  if (intents.back) {
    if (state.screen === "paused") {
      state.screen = "playing";
      state.menuIndex = 0;
    } else if (state.screen !== "title") {
      toTitle(state);
    }
    return;
  }
  if (moved || !intents.confirm) return;

  switch (state.screen) {
    case "title":
      if (state.menuIndex === 0) startRun(world, state);
      else {
        state.screen = "howto";
        state.menuIndex = 0;
      }
      return;
    case "paused":
      if (state.menuIndex === 0) {
        state.screen = "playing";
        state.menuIndex = 0;
      } else if (state.menuIndex === 1) startRun(world, state);
      else toTitle(state);
      return;
    case "victory":
    case "gameover":
      if (state.menuIndex === 0) startRun(world, state);
      else toTitle(state);
      return;
    default:
      return;
  }
}

// ---- The strait ----------------------------------------------------------

/** The bonus catch's own cadence (specs/bays.md). */
function stepFish(state: FloeState, dt: number): void {
  if (!state.fishCadence) return;
  state.fishTimer -= dt;
  if (state.fishTimer > 0) return;

  if (state.fishBay !== null) {
    state.lastFishBay = state.fishBay;
    state.fishBay = null;
    state.fishTimer = FISH_INTERVAL;
    return;
  }
  const open: number[] = [];
  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    if (!state.bays[bay] && bay !== state.lastFishBay) open.push(bay);
  }
  if (open.length === 0) {
    state.fishTimer = FISH_INTERVAL;
    return;
  }
  const bay = pick(state, open) ?? open[0];
  state.fishBay = bay;
  state.lastFishBay = bay;
  state.fishTimer = FISH_LINGER;
}

// ---- The hunt ------------------------------------------------------------

/** The advance and the delay each slot of the hunt needs (specs/hunter.md). */
function slotConditions(index: number): { rows: number; delay: number } {
  if (index === 0) {
    return { rows: BEAR_EMERGE_ADVANCE, delay: BEAR_EMERGE_DELAY };
  }
  return {
    rows: BEAR_EMERGE_ADVANCE + BEAR_SECOND_ADVANCE,
    delay: BEAR_EMERGE_DELAY + BEAR_SECOND_DELAY,
  };
}

/**
 * How close a clock has to come to a figure to count as having reached it.
 *
 * A tick is `1/120` s and neither that nor most of the durations in the
 * specification is exact in binary, so a clock summed tick by tick lands a few
 * parts in a quadrillion short of the figure it was meant to reach. Without this
 * the emergence delay would take one whole extra tick.
 */
const CLOCK_EPSILON = 1e-9;

/** Fill any empty slot whose two conditions have both been met. */
function stepEmergence(world: World, state: FloeState, dt: number): void {
  const critter = critterOf(world);
  const advanced = rowsAdvanced(critter.bestRow);
  state.slots.forEach((slot, index) => {
    if (slot.bearId !== null) return;
    slot.emptyFor += dt;
    if (!state.bearEmergence) return;
    const { rows, delay } = slotConditions(index);
    if (advanced < rows) return;
    if (slot.emptyFor + CLOCK_EPSILON < delay) return;
    const bear = spawnBear(world, state, critterCol(critter), ROW_NEAR);
    slot.bearId = bear.id;
  });
}

/** Whether a moving vehicle covers either tile a bear occupies. */
function struckByTraffic(world: World, state: FloeState, bear: Bear): boolean {
  const tiles: [number, number][] = [
    [bear.col, bear.row],
    [bear.stepCol, bear.stepRow],
  ];
  for (const [col, row] of tiles) {
    const lane = laneAt(state, row);
    if (lane === null || lane.speed <= 0) continue;
    if (vehicleOnTile(world, col, row) !== null) return true;
  }
  return false;
}

/** Sense, travel, and route every bear for one tick (specs/hunter.md). */
function stepBears(world: World, state: FloeState, dt: number): void {
  const critter = critterOf(world);
  for (const bear of bearsOf(world)) {
    if (bear.sense && critter.present) {
      bear.target = { col: critterCol(critter), row: critterRow(critter) };
    }
    travelBear(world, state, bear, dt);
    if (isSettled(bear) && bear.routing) {
      const facing = chooseStep(world, state, bear);
      if (facing !== null) commitStep(world, bear, facing);
    }
  }
  // Traffic arriving on either tile a bear occupies takes it off the strait.
  for (const bear of bearsOf(world)) {
    if (struckByTraffic(world, state, bear)) dropBear(state, bear);
  }
}

// ---- The crossing --------------------------------------------------------

/** Whether a hold is running, which is what suspends the crossing's own clock. */
function holding(state: FloeState): boolean {
  return state.phase !== "crossing" || state.phaseTimer > 0;
}

/** Count a hold down, and run what expiring it leads to. */
function stepHold(world: World, state: FloeState, dt: number, bus: Bus): void {
  if (state.phaseTimer <= 0) return;
  state.phaseTimer -= dt;
  if (state.phaseTimer > 0) return;
  state.phaseTimer = 0;

  if (state.phase === "dying") {
    if (state.lives <= 0) {
      state.screen = "gameover";
      state.menuIndex = 0;
      state.phase = "crossing";
      bus.cue(CUES.gameOver);
      return;
    }
    beginCrossing(world, state);
    return;
  }
  if (state.phase === "clearing") {
    openLevel(world, state, state.level + 1);
    beginCrossing(world, state);
    return;
  }
  // A bay-fill hold, which the next crossing begins from.
  beginCrossing(world, state);
}

/** The critter's own tick: its cooldown, its hop, and the floe carrying it. */
function stepCritter(
  world: World,
  state: FloeState,
  intents: Intents,
  dt: number,
  bus: Bus,
): void {
  const critter = critterOf(world);
  critter.prevX = critter.transform.x;
  critter.prevY = critter.transform.y;
  critter.hopCooldown = Math.max(0, critter.hopCooldown - dt);

  const facing = requested(intents);
  if (facing !== null && critter.hopCooldown <= 0) {
    tryHop(world, state, facing, bus);
    if (!critter.present) return;
  }

  const row = critterRow(critter);
  if (!isWaterRow(row)) return;
  if (floeAtPoint(world, critter.transform.x, row) === null) return;
  const lane = laneAt(state, row);
  if (lane === null) return;
  critter.transform.x += lane.dir * lane.speed * TILE * dt;
}

/** Everything on the strait that can cost a life this tick. */
function stepHazards(world: World, state: FloeState, bus: Bus): void {
  const critter = critterOf(world);
  const row = critterRow(critter);

  if (critter.transform.x < 0 || critter.transform.x > STRAIT_W) {
    loseLife(world, state, "splash", bus);
    return;
  }
  if (vehicleAtPoint(world, critter.transform.x, row) !== null) {
    const lane = laneAt(state, row);
    if (lane !== null && lane.speed > 0) {
      loseLife(world, state, "crush", bus);
      return;
    }
  }
  if (critterFooting(world, critter) === "water") {
    loseLife(world, state, "splash", bus);
  }
}

/** Whether a bear has reached the critter (specs/hunter.md). */
function stepCatch(world: World, state: FloeState, bus: Bus): void {
  const critter = critterOf(world);
  if (!state.catchTest || !critter.present) return;
  for (const bear of bearsOf(world)) {
    const distance = Math.hypot(
      bear.transform.x - critter.transform.x,
      bear.transform.y - critter.transform.y,
    );
    if (distance > BEAR_CATCH_DIST) continue;
    // The lunge outlives the bear by the length of the hold: the catch takes
    // every bear off the strait on this tick, and `specs/assets.md` still asks
    // for the lunge frames on it.
    state.effects.push({
      kind: "lunge",
      x: bear.transform.x,
      y: bear.transform.y,
      life: DEATH_PAUSE,
      span: DEATH_PAUSE,
    });
    loseLife(world, state, "caught", bus);
    return;
  }
}

/** Age the splashes and sprays a death leaves behind. */
function stepEffects(state: FloeState, dt: number): void {
  if (state.effects.length === 0) return;
  for (const effect of state.effects) effect.life -= dt;
  state.effects = state.effects.filter((effect) => effect.life > 0);
}

// ---- One tick ------------------------------------------------------------

/**
 * Advance the whole game by one tick of `dt` seconds.
 *
 * The order is the file's contract. `simTime` first, because it accumulates
 * whatever the screen; then the screen's own edges; then the strait, which runs
 * on every screen but `paused`; then the crossing, which runs only while one is
 * being played. The bonus catch's actor is brought into line with `fishBay` at
 * the end, whichever branch the tick took.
 */
export function stepTick(
  world: World,
  state: FloeState,
  intents: Intents,
  dt: number,
  bus: Bus,
): void {
  runTick(world, state, intents, dt, bus);
  syncFish(world, state);
}

function runTick(
  world: World,
  state: FloeState,
  intents: Intents,
  dt: number,
  bus: Bus,
): void {
  state.simTime += dt;
  stepScreen(world, state, intents, bus);
  if (state.screen === "paused") return;

  advanceLanes(world, state, dt);
  stepEffects(state, dt);
  if (state.screen !== "playing") return;

  stepFish(state, dt);
  stepHold(world, state, dt, bus);

  const critter = critterOf(world);
  if (!holding(state) && critter.present) {
    stepEmergence(world, state, dt);
    stepCritter(world, state, intents, dt, bus);
  }
  stepBears(world, state, dt);
  if (!holding(state) && critter.present) {
    if (state.timerRunning) {
      state.timer = Math.max(0, state.timer - dt);
      if (state.timer <= 0) {
        loseLife(world, state, "timeout", bus);
        return;
      }
    }
    stepHazards(world, state, bus);
  }
  if (!holding(state)) stepCatch(world, state, bus);
}

// ---- Presenting ----------------------------------------------------------

/**
 * Choose each body's frame and write its interpolation offset, `alpha` of a tick
 * into the next one.
 *
 * Called by the game mode once its ticks have run and before the pipeline
 * renders (`src/game.ts`), so the picture is drawn from the state the tick
 * settled on. The dependency runs one way: the simulation reads nothing written
 * here (specs/instrumentation.md).
 */
export function present(world: World, state: FloeState, alpha: number): void {
  critterOf(world).sync(alpha, state.simTime);
  for (const bear of bearsOf(world)) {
    bear.sync(alpha, state.simTime, bearSwimming(world, bear));
  }
  for (const item of vehiclesOf(world)) {
    const lane = laneAt(state, item.row);
    item.sync(alpha, lane !== null && lane.dir === -1);
  }
  // A floe is never mirrored (specs/assets.md). The bonus catch does not move
  // while it is out, so it draws from its own transform with no interpolation.
  for (const item of floesOf(world)) item.sync(alpha, false);
}
