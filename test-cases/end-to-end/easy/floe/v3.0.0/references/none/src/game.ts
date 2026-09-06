// Floe — the game itself: the rules, the run, and the screens.
//
// One tick is the whole clock (specs/overview.md), so everything that happens in
// Floe happens in `stepGame` below, in the order this file fixes: the screen and
// its menu first, then the strait, then the crossing on it. Nothing here draws
// and nothing here reads the wall clock: the core is render-free, and a tick
// means the same thing whatever the frame rate.
//
// The state is a plain object (`src/types.ts`) advanced in place. The debug
// surface (`src/debug.ts`) poses fields of that same object and then lets these
// rules run from there, so a scenario driven from code behaves exactly like one
// played by hand.

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
  FISH_INTERVAL,
  FISH_LINGER,
  HOP_COOLDOWN,
  MAX_BEARS,
  ROW_BAYS,
  ROW_CAP,
  ROW_NEAR,
  SCORE_BAY,
  SCORE_BONUS_CATCH,
  SCORE_LEVEL,
  SCORE_ROW,
  SCORE_TIME_BONUS,
  SCORE_VICTORY_LIFE,
  SECOND_BEAR_LEVEL,
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
import { menuItemAt, menuItems } from "./menus";
import type { PointerEdge } from "./pointer";
import {
  bayIndexAtCol,
  facingDX,
  facingDY,
  isWaterRow,
  rowsAdvanced,
} from "./grid";
import {
  advanceLanes,
  laneAt,
  layoutLevel,
  floeAtPoint,
  vehicleAtPoint,
  vehicleOnTile,
} from "./lanes";
import {
  critterCol,
  critterFooting,
  critterRow,
  dropAllBears,
  dropBear,
  freshCritter,
  isSettled,
  makeBear,
} from "./entities";
import { chooseStep, commitStep, travelBear } from "./hunter";
import { BINDINGS } from "./constants";
import { defineCues } from "./audio";
import { registerDiagnostics } from "./diagnostics";
import { render } from "./render";
import type { Art } from "./assets";
import type { Game, InitApi, RenderApi, UpdateApi } from "./runtime";
import { pick } from "./rng";
import type { Bear, Death, Effect, Facing, FloeState } from "./types";

/**
 * What one tick may reach outside the state: the cue bus and the runtime's mute
 * bit. Structural, so a test drives the rules with a bus of its own.
 */
export interface Bus {
  /** Play a declared cue. */
  cue(name: CueName): void;
  /** Whether the runtime is muted. */
  muted(): boolean;
  /** Mute or unmute the runtime. */
  setMuted(muted: boolean): void;
}

/** A bus that does nothing, for a pose that must make no sound. */
export const SILENT: Bus = {
  cue: () => undefined,
  muted: () => false,
  setMuted: () => undefined,
};

/** The tick's input, resolved out of the keyboard before the rules see it. */
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
  /**
   * The tick's pointer and touch edges, in the order they were raised, in
   * logical stage units (`specs/ui.md`).
   *
   * Applied after the tick's keyboard edges, so a tick carrying both a keyboard
   * movement edge and a pointer selection leaves the highlight where the pointer
   * put it, and a tick carrying a keyboard confirm confirms the keyboard's item
   * alone.
   */
  pointer: readonly PointerEdge[];
}

/** No key at all: what a tick driven with nothing held is given. */
export const NO_INTENTS: Intents = {
  held: null,
  up: false,
  down: false,
  left: false,
  right: false,
  confirm: false,
  back: false,
  pause: false,
  mute: false,
  pointer: [],
};

// ---- Building and resetting ---------------------------------------------

/** The state a freshly loaded build holds: the title screen, level 1 laid out. */
export function createState(): FloeState {
  const state: FloeState = {
    screen: "title",
    menuIndex: 0,
    phase: "crossing",
    phaseTimer: 0,
    level: 1,
    reachedLevel: 1,
    lives: START_LIVES,
    score: 0,
    timer: crossingTimer(1),
    bays: openBays(),
    fishBay: null,
    fishTimer: FISH_INTERVAL,
    lastFishBay: null,
    critter: { ...freshCritter(), present: false },
    bears: [],
    slots: [],
    iceLanes: [],
    waterLanes: [],
    vehicles: [],
    floes: [],
    bearEmergence: true,
    catchTest: true,
    fishCadence: true,
    timerRunning: true,
    simTime: 0,
    muted: false,
    nextId: 1,
    effects: [],
  };
  resetState(state);
  return state;
}

/** Five open bays. */
function openBays(): boolean[] {
  return Array.from({ length: BAY_COUNT }, () => false);
}

/** The hunt's slots for a level: one below `SECOND_BEAR_LEVEL`, two from it. */
function freshSlots(level: number): FloeState["slots"] {
  const count = level >= SECOND_BEAR_LEVEL ? MAX_BEARS : 1;
  return Array.from({ length: count }, () => ({ bearId: null, emptyFor: 0 }));
}

/**
 * Restore every field to its title-screen value (specs/instrumentation.md).
 *
 * `muted` is deliberately untouched: muting is a player preference the runtime
 * owns, and a reset is not a reason to start making noise again.
 */
export function resetState(state: FloeState): void {
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
  state.critter = { ...freshCritter(), present: false };
  state.bears = [];
  state.slots = freshSlots(1);
  state.bearEmergence = true;
  state.catchTest = true;
  state.fishCadence = true;
  state.timerRunning = true;
  state.simTime = 0;
  state.nextId = 1;
  state.effects = [];
  layoutLevel(state, 1);
}

/** Open a run at level 1 with a fresh crossing (specs/progression.md). */
export function startRun(state: FloeState): void {
  state.level = 1;
  state.reachedLevel = 1;
  state.lives = START_LIVES;
  state.score = 0;
  state.bays = openBays();
  state.fishBay = null;
  state.fishTimer = FISH_INTERVAL;
  state.lastFishBay = null;
  state.effects = [];
  layoutLevel(state, 1);
  state.screen = "playing";
  beginCrossing(state);
}

/** Put a fresh critter on the near shore and start its timer over. */
export function beginCrossing(state: FloeState): void {
  state.critter = freshCritter();
  state.timer = crossingTimer(state.level);
  state.phase = "crossing";
  state.phaseTimer = 0;
  state.bears = [];
  state.slots = freshSlots(state.level);
}

/** Lay the strait out for a level and open every bay (specs/progression.md). */
function openLevel(state: FloeState, level: number): void {
  state.level = level;
  state.reachedLevel = Math.max(state.reachedLevel, level);
  state.bays = openBays();
  state.fishBay = null;
  state.fishTimer = FISH_INTERVAL;
  state.lastFishBay = null;
  layoutLevel(state, level);
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

/** What each death leaves on the strait; two of the four leave nothing. */
const DEATH_MARK: Record<Death, Effect["kind"] | null> = {
  crush: "spray",
  splash: "splash",
  caught: null,
  timeout: null,
};

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
export function loseLife(state: FloeState, cause: Death, bus: Bus): void {
  state.lives -= 1;
  state.phase = "dying";
  state.phaseTimer = DEATH_PAUSE;
  state.critter.present = false;
  dropAllBears(state);
  const cue = DEATH_CUE[cause];
  if (cue !== null) bus.cue(cue);
  // The splash and the spray belong to a fall and to a crush (specs/assets.md).
  // A catch is drawn by the lunge the bear left behind, and a timer running out
  // is drawn by nothing.
  const mark = DEATH_MARK[cause];
  if (mark !== null) {
    state.effects.push({
      kind: mark,
      x: state.critter.x,
      y: state.critter.y,
      life: DEATH_PAUSE,
      span: DEATH_PAUSE,
    });
  }
}

// ---- The hop -------------------------------------------------------------

/** Whether a hop onto a tile is refused (specs/hopping.md). */
export function hopRefused(
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
  return vehicleOnTile(state, col, row) !== null;
}

/** Take one hop, if the rules accept it. Returns whether the critter moved. */
export function tryHop(state: FloeState, facing: Facing, bus: Bus): boolean {
  const critter = state.critter;
  const col = colAt(critter.x) + facingDX(facing);
  const row = rowAt(critter.y) + facingDY(facing);
  if (hopRefused(state, col, row)) return false;

  critter.x = tileCX(col);
  critter.y = tileCY(row);
  critter.prevX = critter.x;
  critter.prevY = critter.y;
  critter.facing = facing;
  critter.hopCooldown = HOP_COOLDOWN;
  bus.cue(CUES.hop);

  if (row < critter.bestRow) {
    critter.bestRow = row;
    addScore(state, SCORE_ROW, bus);
  }
  if (row === ROW_BAYS) fillBay(state, bayIndexAtCol(col), bus);
  return true;
}

/**
 * End a crossing in a bay (specs/bays.md, specs/scoring.md).
 *
 * A level clears on THIS transition rather than on the count of filled bays, so a
 * strait whose bays were posed filled is a level still being played.
 */
function fillBay(state: FloeState, bay: number, bus: Bus): void {
  state.bays[bay] = true;
  state.critter.present = false;
  dropAllBears(state);
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
  return menuItems(state.screen).length;
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

/** Open the pause menu over a frozen strait. */
function pauseGame(state: FloeState): void {
  state.screen = "paused";
  state.menuIndex = 0;
}

/** Leave the pause menu, resuming the crossing exactly as it stood. */
function resumeGame(state: FloeState): void {
  state.screen = "playing";
  state.menuIndex = 0;
}

/**
 * The title entry that opens the how-to screen, which leaving it selects again
 * (`specs/ui.md`).
 */
const HOWTO_ENTRY = TITLE_ITEMS.indexOf("HOW TO PLAY");

/**
 * The title entry that starts a run, which every route back from a run selects
 * again (`specs/ui.md`).
 */
const CROSS_ENTRY = TITLE_ITEMS.indexOf("CROSS");

/**
 * Return to the title screen with `selected` highlighted, leaving the strait
 * where it stands.
 *
 * Every route back selects the entry it left by (`specs/ui.md`): leaving the
 * how-to screen selects `HOW TO PLAY`, and `QUIT TO MENU`, `MENU` and back from
 * either ending screen all select `CROSS`.
 */
function toTitle(state: FloeState, selected: number): void {
  state.screen = "title";
  state.menuIndex = selected;
}

/** Everything a screen does with the tick's edges. */
function stepScreen(state: FloeState, intents: Intents, bus: Bus): void {
  if (intents.mute) {
    bus.setMuted(!bus.muted());
    state.muted = bus.muted();
  }

  if (state.screen === "playing") {
    // `Escape` drives both pause and back; on this screen it pauses.
    if (intents.pause) pauseGame(state);
    return;
  }

  const moved = moveMenu(state, intents, bus);

  if (state.screen === "howto") {
    if (intents.back || intents.confirm) toTitle(state, HOWTO_ENTRY);
    return;
  }
  // Pause closes the pause menu exactly as back does, so `KeyP` resumes as well
  // as `Escape` (specs/ui.md).
  if (state.screen === "paused" && (intents.back || intents.pause)) {
    resumeGame(state);
    return;
  }
  // The title screen is the outermost screen, so back does nothing there and the
  // tick goes on to its pointer edges.
  if (intents.back && state.screen !== "title") {
    toTitle(state, CROSS_ENTRY);
    return;
  }
  if (!moved && intents.confirm) {
    confirmItem(state);
    return;
  }
  // Nothing the keyboard did left this screen, so the tick's pointer and touch
  // edges are still about the menu in front of the player.
  stepPointer(state, intents, bus);
}

/** Act on the highlighted item of whatever menu the screen carries. */
function confirmItem(state: FloeState): void {
  switch (state.screen) {
    case "title":
      if (state.menuIndex === 0) startRun(state);
      else {
        state.screen = "howto";
        state.menuIndex = 0;
      }
      return;
    case "paused":
      if (state.menuIndex === 0) resumeGame(state);
      else if (state.menuIndex === 1) startRun(state);
      else toTitle(state, CROSS_ENTRY);
      return;
    case "victory":
    case "gameover":
      if (state.menuIndex === 0) startRun(state);
      else toTitle(state, CROSS_ENTRY);
      return;
    default:
      return;
  }
}

/**
 * The tick's pointer and touch edges, applied to the menu in front of the player
 * (`specs/ui.md`).
 *
 * An aim selects whatever item it is over. A release confirms only when both of
 * its ends — the press and the lift, or the landing and the lift — fall in one
 * item's region; a gesture that began outside every region, ended outside one, or
 * crossed from one to another selects what it aimed at and confirms nothing.
 *
 * Read in the order the edges arrived, so a press and the release that follows it
 * inside one tick confirm on that tick.
 */
function stepPointer(state: FloeState, intents: Intents, bus: Bus): void {
  for (const edge of intents.pointer) {
    if (menuLength(state) === 0) return;
    const at = menuItemAt(state.screen, edge.x, edge.y);
    if (at !== null && at !== state.menuIndex) {
      state.menuIndex = at;
      bus.cue(CUES.menu);
    }
    if (edge.kind !== "release") continue;
    const from = menuItemAt(state.screen, edge.fromX, edge.fromY);
    if (at === null || from !== at) continue;
    confirmItem(state);
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
  const bay = pick(open) ?? open[0];
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
function stepEmergence(state: FloeState, dt: number): void {
  const advanced = rowsAdvanced(state.critter.bestRow);
  state.slots.forEach((slot, index) => {
    if (slot.bearId !== null) return;
    slot.emptyFor += dt;
    if (!state.bearEmergence) return;
    const { rows, delay } = slotConditions(index);
    if (advanced < rows) return;
    if (slot.emptyFor + CLOCK_EPSILON < delay) return;
    const bear = makeBear(state, critterCol(state.critter), ROW_NEAR);
    state.bears.push(bear);
    slot.bearId = bear.id;
  });
}

/**
 * Let a settled bear commit its next step (specs/hunter.md).
 *
 * Called on both sides of the bear's travel, and that is what keeps its speed
 * exact. A bear standing on a tile with no step — one that has just arrived on
 * the strait, one whose routing found nowhere to go last tick — is given its step
 * BEFORE it travels, so the tick it is standing on is not a tick it loses; and a
 * bear that settles DURING its travel is given its next step after it, so the
 * leftover travel it carries is spent on the tick that follows rather than
 * waiting for one on which nothing moves.
 */
function routeBear(state: FloeState, bear: Bear): void {
  if (!isSettled(bear) || !bear.routing) return;
  const facing = chooseStep(state, bear);
  if (facing !== null) commitStep(state, bear, facing);
}

/** Sense, travel, and route every bear for one tick (specs/hunter.md). */
function stepBears(state: FloeState, dt: number): void {
  for (const bear of [...state.bears]) {
    if (bear.sense && state.critter.present) {
      bear.target = {
        col: critterCol(state.critter),
        row: critterRow(state.critter),
      };
    }
    routeBear(state, bear);
    travelBear(state, bear, dt);
    routeBear(state, bear);
  }
  // Traffic arriving on either tile a bear occupies takes it off the strait.
  for (const bear of [...state.bears]) {
    if (struckByTraffic(state, bear)) dropBear(state, bear.id);
  }
}

/** Whether a moving vehicle covers either tile a bear occupies. */
function struckByTraffic(state: FloeState, bear: Bear): boolean {
  const tiles: [number, number][] = [
    [bear.col, bear.row],
    [bear.stepCol, bear.stepRow],
  ];
  for (const [col, row] of tiles) {
    const lane = laneAt(state, row);
    if (lane === null || lane.speed <= 0) continue;
    if (vehicleOnTile(state, col, row) !== null) return true;
  }
  return false;
}

// ---- The crossing --------------------------------------------------------

/** Whether a hold is running, which is what suspends the crossing's own clock. */
function holding(state: FloeState): boolean {
  return state.phase !== "crossing" || state.phaseTimer > 0;
}

/** Count a hold down, and run what expiring it leads to. */
function stepHold(state: FloeState, dt: number, bus: Bus): void {
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
    beginCrossing(state);
    return;
  }
  if (state.phase === "clearing") {
    openLevel(state, state.level + 1);
    beginCrossing(state);
    return;
  }
  // A bay-fill hold, which the next crossing begins from.
  beginCrossing(state);
}

/** The critter's own tick: its cooldown, its hop, and the floe carrying it. */
function stepCritter(
  state: FloeState,
  intents: Intents,
  dt: number,
  bus: Bus,
): void {
  const critter = state.critter;
  critter.prevX = critter.x;
  critter.prevY = critter.y;
  critter.hopCooldown = Math.max(0, critter.hopCooldown - dt);

  // The floe under it carries it BEFORE it may hop, so an accepted hop leaves
  // the critter's centre exactly on the target tile's centre at the end of the
  // tick (specs/hopping.md). The carry belongs to the tile the critter was
  // standing on, not to the one it hopped to.
  carryRider(state, dt);

  if (intents.held !== null && critter.hopCooldown <= 0) {
    tryHop(state, intents.held, bus);
  }
}

/** The floe under the critter, carrying it along its lane (specs/water.md). */
function carryRider(state: FloeState, dt: number): void {
  const critter = state.critter;
  const row = critterRow(critter);
  if (!isWaterRow(row)) return;
  if (floeAtPoint(state, critter.x, row) === null) return;
  const lane = laneAt(state, row);
  if (lane === null) return;
  critter.x += lane.dir * lane.speed * TILE * dt;
}

/** Everything on the strait that can cost a life this tick. */
function stepHazards(state: FloeState, bus: Bus): void {
  const critter = state.critter;
  const row = critterRow(critter);

  if (critter.x < 0 || critter.x > STRAIT_W) {
    loseLife(state, "splash", bus);
    return;
  }
  const vehicle = vehicleAtPoint(state, critter.x, row);
  if (vehicle !== null) {
    const lane = laneAt(state, row);
    if (lane !== null && lane.speed > 0) {
      loseLife(state, "crush", bus);
      return;
    }
  }
  if (critterFooting(state) === "water") {
    loseLife(state, "splash", bus);
  }
}

/** Whether a bear has reached the critter (specs/hunter.md). */
function stepCatch(state: FloeState, bus: Bus): void {
  if (!state.catchTest || !state.critter.present) return;
  for (const bear of state.bears) {
    const distance = Math.hypot(
      bear.x - state.critter.x,
      bear.y - state.critter.y,
    );
    if (distance > BEAR_CATCH_DIST) continue;
    // The lunge is drawn where the bear met the critter. It is recorded before
    // the life is taken, because taking it removes every bear from the strait.
    state.effects.push({
      kind: "lunge",
      x: bear.x,
      y: bear.y,
      life: DEATH_PAUSE,
      span: DEATH_PAUSE,
    });
    loseLife(state, "caught", bus);
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
 * being played.
 */
export function stepGame(
  state: FloeState,
  intents: Intents,
  dt: number,
  bus: Bus,
): void {
  // A crossing advances only on a tick that BOTH began and ended on the
  // `playing` screen. The tick a menu starts a run on is that menu's tick: the
  // fresh crossing it laid down is left untouched, so its timer reads exactly
  // `timerMax` and nothing on the strait has reached the critter yet. The tick
  // that pauses is the crossing's last, so pausing freezes the strait where the
  // player saw it (specs/progression.md, specs/ui.md).
  const wasPlaying = state.screen === "playing";
  state.simTime += dt;
  stepScreen(state, intents, bus);
  if (state.screen === "paused") return;

  advanceLanes(state, dt);
  stepEffects(state, dt);
  if (!wasPlaying || state.screen !== "playing") return;

  stepFish(state, dt);
  stepHold(state, dt, bus);

  if (!holding(state) && state.critter.present) {
    stepEmergence(state, dt);
    stepCritter(state, intents, dt, bus);
  }
  stepBears(state, dt);
  if (!holding(state) && state.critter.present) {
    if (state.timerRunning) {
      state.timer = Math.max(0, state.timer - dt);
      if (state.timer <= 0) {
        loseLife(state, "timeout", bus);
        return;
      }
    }
    stepHazards(state, bus);
  }
  if (!holding(state)) stepCatch(state, bus);
}

// ---- The game the runtime drives ----------------------------------------

/**
 * Resolve the tick's keyboard into the intents the rules are written against.
 *
 * A DIRECTION IS BEING REQUESTED WHEN IT IS DOWN NOW OR WENT DOWN SINCE THE LAST
 * TICK. The held reading alone would drop a tap: a press and its release both
 * land between two ticks at 120 Hz, and by the time the tick runs the key is up
 * again, so `specs/hopping.md`'s "a press released before the cooldown reaches 0
 * produces exactly one hop" would produce none. Taking the edge as a request
 * costs nothing to a held key, which raises its edge once and then reads as
 * down.
 *
 * Every edge is read, and so consumed, on every tick, and each is read exactly
 * once: an edge left armed would surface later, out of order, and an edge read
 * twice would be consumed by the first read.
 */
function readIntents(api: UpdateApi): Intents {
  const edges = {
    up: api.input.pressed("up"),
    down: api.input.pressed("down"),
    left: api.input.pressed("left"),
    right: api.input.pressed("right"),
    confirm: api.input.pressed("confirm"),
    back: api.input.pressed("back"),
    pause: api.input.pressed("pause"),
    mute: api.input.pressed("mute"),
  };
  const asked = (name: Facing): boolean =>
    api.input.value(name) > 0 || edges[name];
  const held: Facing | null = asked("up")
    ? "up"
    : asked("down")
      ? "down"
      : asked("left")
        ? "left"
        : asked("right")
          ? "right"
          : null;
  return { held, ...edges, pointer: api.input.pointer() };
}

/**
 * Bind the game to the art it draws from.
 *
 * The art is loaded before the runtime is built (`src/main.ts`), so `initialize`
 * stays the one synchronous call that produces the whole state.
 */
export function createFloe(art: Art): Game<FloeState> {
  return {
    initialize(api: InitApi): FloeState {
      for (const [action, keys] of Object.entries(BINDINGS)) {
        api.input.register(action, keys);
      }
      defineCues(api);
      const state = createState();
      registerDiagnostics(api, state);
      return state;
    },

    update(state: FloeState, api: UpdateApi, dt: number): void {
      state.muted = api.audio.muted();
      stepGame(state, readIntents(api), dt, {
        cue: (name) => api.audio.play(name),
        muted: () => api.audio.muted(),
        setMuted: (muted) => api.audio.setMuted(muted),
      });
    },

    render(state: FloeState, api: RenderApi): void {
      render(state, art, api.ctx, api.alpha);
    },
  };
}
