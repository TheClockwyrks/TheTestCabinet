// Fathom — the dive itself.
//
// One state value, one fixed tick over it, and the flow between the seven
// screens. Everything the specification fixes about what happens in the trench
// converges here: the controls each screen reads, the forager's travel and its
// grazing, the brightness and the light, the sonar pulse and the ink, the den
// schedule and the hunters' step, the drifter cadence, contact, scoring, and the
// descent.
//
// What is NOT here: the rules of a single system. The maze is `src/maze.ts`, the
// fog `src/sensing.ts`, the wavefront `src/sonar.ts`, the tile-locked stepping
// `src/entities.ts`, and each hunter's own mind `src/predators.ts`. This module
// is the place they meet and the order they run in.
//
// The state is a plain object and the tick is a function over it, so the debug
// surface (`src/debug.ts`) poses situations by writing the same fields play
// writes and the game's own systems produce everything that follows.

import type { Assets } from "./assets";
import { defineCues } from "./audio";
import {
  BRIGHT_HALFLIFE,
  BRIGHT_HOLD,
  BRIGHT_PER_EAT,
  BINDINGS,
  DEN_RELEASE_GAP,
  DRIFTER_INTERVAL,
  DRIFTER_MAX,
  DRIFTER_SPEED,
  FLARE_INTERVAL,
  FLARE_RADIUS,
  FORAGER_SPEED,
  GAMEOVER_ITEMS,
  GLOAMFIN_CHASE_SPEED,
  GLOAMFIN_PING_INTERVAL,
  GLOAMFIN_PING_RANGE,
  GRID_COLS,
  GRID_ROWS,
  INK_COOLDOWN,
  PAUSE_ITEMS,
  SCORE_CLEAR,
  SCORE_DRIFTER,
  SCORE_PLANKTON,
  SONAR_COOLDOWN,
  SONAR_MARK_TIME,
  START_LIVES,
  TITLE_ITEMS,
  type CueName,
} from "./constants";
import { registerDiagnostics } from "./diagnostics";
import { Effects } from "./effects";
import {
  advance,
  Drifter,
  Forager,
  Predator,
  wanderDir,
  type Mover,
} from "./entities";
import { InkField } from "./ink";
import { Maze, SHIPPED_LAYOUT, SHIPPED_START } from "./maze";
import { itemAt } from "./menu";
import {
  acquire,
  armPingTimers,
  decayPredatorTimers,
  isBlooming,
  updatePredator,
  type PredatorWorld,
} from "./predators";
import { roster, sonarRange, visionRadius } from "./readings";
import { render } from "./render";
import { Rng } from "./rng";
import { Fog, tileKey } from "./sensing";
import { SonarWave } from "./sonar";
import {
  CLEARED_HOLD,
  COUNTDOWN_NUMBERS,
  COUNTDOWN_STEP,
  PULSE_BAND,
} from "./theme";
import type { Game, InitApi, RenderApi, TickApi } from "./runtime";
import type { Cell, Heading, Screen } from "./types";
import { DIRS } from "./types";

/** The whole of the dive, in one value. */
export interface FathomState {
  /** The art every draw comes from, loaded before the game was built. */
  readonly assets: Assets;

  screen: Screen;
  /** Which item of the current screen's menu is highlighted. */
  menu: number;
  /**
   * The title menu's remembered selection: the item last confirmed there, `0`
   * until one has been. Every arrival at the title takes `menu` from it
   * (`specs/ui.md`), and it survives the return a dive is put back by.
   */
  titleIndex: number;
  /**
   * The menu item a pointer or a finger is currently pressed on, or `null`.
   *
   * A confirm requires both of its edges inside ONE region (`specs/ui.md`), so the
   * region the press landed in has to outlive the frame it landed on. It is
   * derived from the gesture in flight and nothing else, and every screen change
   * drops it, so no pose can leave a press latched over a menu it was not made
   * on.
   */
  pressedItem: number | null;

  depth: number;
  score: number;
  lives: number;
  /** The game's readable copy of the runtime's mute bit. */
  muted: boolean;
  /** Accumulated simulation time, in seconds, across every screen. */
  simTime: number;

  readonly maze: Maze;
  readonly fog: Fog;
  readonly effects: Effects;
  readonly ink: InkField;
  readonly rng: Rng;

  forager: Forager;
  predators: Predator[];
  drifters: Drifter[];
  /** Every wavefront in flight, the forager's pulses and the pings alike. */
  waves: SonarWave[];

  /** One flag per tile, in the row-major order `tileKey` fixes. */
  plankton: boolean[];
  planktonRemaining: number;

  sonarCooldown: number;
  inkCooldown: number;

  /** Seconds left of the dive countdown, and of the cleared interstitial. */
  countdown: number;
  clearedTimer: number;
  /** Seconds to the next bonus drifter being admitted at the gate. */
  drifterTimer: number;

  /**
   * The forager's desired direction, buffered so a direction set slightly
   * before a junction is still desired when the junction's center arrives.
   */
  desired: Heading;

  /**
   * The cues the tick in progress has raised, played once each as it ends. A
   * set, so a tick on which two creatures raise the same cue plays it once.
   */
  readonly cues: Set<CueName>;
}

// ---- Building the state ----------------------------------------------------

/** A dive on the title screen, with the shipped maze laid out behind it. */
export function createState(assets: Assets): FathomState {
  const maze = new Maze();
  const state: FathomState = {
    assets,
    screen: "title",
    menu: 0,
    titleIndex: 0,
    pressedItem: null,
    depth: 1,
    score: 0,
    lives: START_LIVES,
    muted: false,
    simTime: 0,
    maze,
    fog: new Fog(),
    effects: new Effects(),
    ink: new InkField(),
    rng: new Rng(),
    forager: new Forager(maze.start.col, maze.start.row, FORAGER_SPEED),
    predators: [],
    drifters: [],
    waves: [],
    plankton: new Array<boolean>(GRID_COLS * GRID_ROWS).fill(false),
    planktonRemaining: 0,
    sonarCooldown: 0,
    inkCooldown: 0,
    countdown: 0,
    clearedTimer: 0,
    drifterTimer: DRIFTER_INTERVAL,
    desired: null,
    cues: new Set<CueName>(),
  };
  layoutMaze(state, true);
  return state;
}

/**
 * Lay the current maze out for play. `fresh` refills the plankton and clears the
 * fog, which is what a new dive and a descent do; without it the memory and the
 * plankton already eaten stay as they are, which is what losing a life does.
 */
export function layoutMaze(state: FathomState, fresh: boolean): void {
  if (fresh) {
    state.fog.reset();
    fillPlankton(state);
  }
  state.forager = new Forager(
    state.maze.start.col,
    state.maze.start.row,
    FORAGER_SPEED,
  );
  state.desired = null;
  buildRoster(state);
  denPredators(state);
  state.drifters = [];
  state.waves = [];
  state.ink.clear();
  state.effects.clear();
  state.sonarCooldown = 0;
  state.inkCooldown = 0;
  state.drifterTimer = DRIFTER_INTERVAL;
}

/** One plankton on every corridor tile; the den chamber and its gate hold none. */
export function fillPlankton(state: FathomState): void {
  state.plankton.fill(false);
  state.planktonRemaining = 0;
  for (const tile of state.maze.corridorTiles()) {
    state.plankton[tileKey(tile.col, tile.row)] = true;
    state.planktonRemaining += 1;
  }
}

/**
 * Restore the plankton layer's one invariant: a plankton stands on an open
 * corridor tile and nowhere else, which `specs/state.md` fixes by reporting rock,
 * the gate and the den chamber as holding none.
 *
 * A layout replaced under a standing board is the only thing that can break it —
 * a plankton the new rock closed over — so this runs there and the count is
 * taken again from what is left.
 */
export function pruneBuriedPlankton(state: FathomState): void {
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const key = tileKey(col, row);
      if (!state.plankton[key]) continue;
      if (!state.maze.isCorridor(col, row)) state.plankton[key] = false;
    }
  }
  state.planktonRemaining = countPlankton(state);
}

/**
 * How many plankton the layer carries (`specs/state.md`).
 *
 * The one place the count comes from: the prune above finishes with it, and the
 * surface's `reconcile` brings the reported `planktonRemaining` back into
 * agreement through the same call, so the two can never say different things.
 */
export function countPlankton(state: FathomState): number {
  let remaining = 0;
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      if (state.plankton[tileKey(col, row)]) remaining += 1;
    }
  }
  return remaining;
}

/**
 * Build the roster the current depth holds, parked on the den's slots in
 * release order.
 *
 * A layout with no den chamber has no slot to park on. Its hunters are built at
 * the grid's top-left corner and held out of play there: undrawn, unmoving, and
 * excluded from contact by their `"den"` state.
 */
export function buildRoster(state: FathomState): void {
  const slots = state.maze.denSlots();
  state.predators = roster(state.depth).map((kind, index) => {
    const slot: Cell =
      slots.length > 0 ? slots[index % slots.length] : { col: 0, row: 0 };
    return new Predator(kind, slot.col, slot.row, index * DEN_RELEASE_GAP);
  });
}

/**
 * Return every predator to a den tile and re-arm the staggered schedule, which
 * runs again from the moment live play resumes.
 */
export function denPredators(state: FathomState): void {
  const slots = state.maze.denSlots();
  state.predators.forEach((p, index) => {
    if (slots.length > 0) {
      const slot = slots[index % slots.length];
      p.placeOn(slot.col, slot.row);
    }
    restPredator(p);
    p.released = false;
    p.denTimer = p.releaseAt;
  });
}

/**
 * Clear every hunt a predator is in the middle of and re-arm the timers its kind
 * runs on, leaving it with no fix, no alert and no beat of a flare playing.
 *
 * It says nothing about where the predator stands, what its `state` is, or
 * whether its turn has come; each caller settles those itself.
 */
export function restPredator(p: Predator): void {
  p.state = "den";
  p.dir = null;
  p.fix = null;
  p.linger = 0;
  p.alertT = 0;
  p.markT = 0;
  p.hearingLock = false;
  p.pingTimer = GLOAMFIN_PING_INTERVAL;
  p.pingGap = 0;
  p.searchTimer = 0;
  p.searchPingTimer = 0;
  p.searchPinged = false;
  p.chaseSpeed = GLOAMFIN_CHASE_SPEED;
  p.flareTimer = FLARE_INTERVAL;
  p.flarePhase = "none";
  p.flarePhaseT = 0;
}

/**
 * Replace the layout with a posed fixture, and change nothing else.
 *
 * The layout is the whole of what this sets. The plankton, the revealed-tile
 * memory, the roster, every body's tile and facing, the cooldowns, the score,
 * the lives, the depth and the screen are all left exactly as they stand, so a
 * caller poses each of those itself.
 *
 * The fixture is used exactly as given and is exempt from every rule of
 * `specs/maze.md`. What it does not have simply takes no part: with no gate the
 * drifter cadence has nowhere to admit a drifter from, and on a layout with no
 * den chamber a predator whose `state` is `"den"` is held out of play.
 *
 * The one thing that follows from the layout itself is the plankton layer's
 * invariant: a plankton the new rock has closed over is no longer on an open
 * corridor tile, so it is off the board and out of the count.
 */
export function poseMaze(state: FathomState, rows: readonly string[]): void {
  state.maze.load(rows);
  pruneBuriedPlankton(state);
}

// ---- The flow between screens ----------------------------------------------

/** The whole hold of the dive countdown, in seconds. */
export const COUNTDOWN_TIME = COUNTDOWN_NUMBERS * COUNTDOWN_STEP;

/**
 * Lay out the maze this build ships, which is the maze it plays at every depth.
 *
 * It is also what drops a posed fixture: a fixture stands until a reset or until
 * the game lays out a maze of its own, and this is that moment.
 */
function loadOwnMaze(state: FathomState): void {
  state.maze.load(SHIPPED_LAYOUT, SHIPPED_START);
}

/** Open a fresh dive, which `DIVE`, `RESTART` and `PLAY AGAIN` all do alike. */
export function beginDive(state: FathomState): void {
  state.score = 0;
  state.lives = START_LIVES;
  state.depth = 1;
  loadOwnMaze(state);
  layoutMaze(state, true);
  toCountdown(state);
}

/** Hold at the top of a maze until the countdown gives way to live play. */
function toCountdown(state: FathomState): void {
  state.screen = "countdown";
  state.countdown = COUNTDOWN_TIME;
}

/**
 * Live play beginning, which is where the den's staggered schedule is timed
 * from (`specs/predators.md`). Release time `0` is this moment, so the first
 * predator's slot has already arrived when the screen turns over and it reports
 * `released` from here rather than a tick later.
 *
 * Every way into live play comes through here: the countdown running out,
 * `RESUME` on the pause menu, and the debugging surface posing the screen. What
 * a predator has already waited out is its own, so resuming a paused dive does
 * not put the schedule back to the beginning.
 */
export function enterPlay(state: FathomState): void {
  state.screen = "playing";
  state.countdown = 0;
  for (const p of state.predators) {
    if (p.released) continue;
    if (p.denTimer <= 0) p.released = true;
  }
}

/**
 * Pose the screen, which the debugging surface's `setScreen` does and nothing
 * else. It sets `screen` and refreshes the timer or the menu index that screen
 * is meaningless without, so the game carries on under its own rules from there.
 */
export function poseScreen(state: FathomState, screen: Screen): void {
  switch (screen) {
    case "countdown":
      toCountdown(state);
      return;
    case "playing":
      enterPlay(state);
      return;
    case "cleared":
      toCleared(state);
      return;
    default:
      openMenu(state, screen);
  }
}

/**
 * Return to the title, which restores what a dive begins from.
 *
 * `titleIndex` is the exception `specs/ui.md` names: it keeps its value across
 * the return, and the selection lands on the entry it holds, so the title comes
 * back on the item the player left it by.
 */
export function toTitle(state: FathomState): void {
  state.score = 0;
  state.lives = START_LIVES;
  state.depth = 1;
  loadOwnMaze(state);
  layoutMaze(state, true);
  openMenu(state, "title");
  state.countdown = 0;
  state.clearedTimer = 0;
}

/** Contact costs a life, and the last one ends the dive. */
function loseLife(state: FathomState): void {
  raiseCue(state, "caught");
  if (state.lives <= 0) {
    openMenu(state, "gameover");
    return;
  }
  state.lives -= 1;
  // The plankton already eaten stay eaten and what the dive has revealed carries
  // across, so the attempt is set up over the maze as it stands.
  layoutMaze(state, false);
  toCountdown(state);
}

/** The maze is cleared by the forager eating the plankton that leaves none. */
function clearMaze(state: FathomState): void {
  state.score += SCORE_CLEAR;
  raiseCue(state, "descend");
  toCleared(state);
}

/** Hold on the interstitial until it gives way to the next maze down. */
function toCleared(state: FathomState): void {
  state.screen = "cleared";
  state.clearedTimer = CLEARED_HOLD;
}

/** The next maze, one depth deeper, opening on the countdown as the first did. */
function descend(state: FathomState): void {
  state.depth += 1;
  loadOwnMaze(state);
  layoutMaze(state, true);
  toCountdown(state);
}

// ---- The controls ----------------------------------------------------------

/** Raise a cue for this tick. It sounds once, however many times it is raised. */
export function raiseCue(state: FathomState, cue: CueName): void {
  state.cues.add(cue);
}

/** Play everything the tick raised, then leave the set empty for the next one. */
function flushCues(state: FathomState, api: TickApi): void {
  for (const cue of state.cues) api.audio.play(cue);
  state.cues.clear();
}

/**
 * Read the controls for the screen the game is on.
 *
 * `mute` is read on every screen. Every other action belongs to one row of
 * `specs/movement.md`, so one key does one thing on any given screen even where
 * two actions share it.
 */
function readControls(state: FathomState, api: TickApi): void {
  if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());
  state.muted = api.audio.muted();

  switch (state.screen) {
    case "playing":
      readPlay(state, api);
      return;
    case "title":
      readMenu(state, api, TITLE_ITEMS.length, (index) => {
        // Confirming an entry here records it, from the keyboard, a pointer and
        // a contact alike, and every later arrival at the title lands on it
        // (`specs/ui.md`).
        state.titleIndex = index;
        if (index === 0) beginDive(state);
        else openMenu(state, "howto");
      });
      return;
    case "howto": {
      // The screen shows no menu, so besides the two controls that leave it a
      // gesture completed anywhere on it returns to the title (`specs/ui.md`).
      // All three are read before any is acted on, so nothing is left armed.
      const left = api.input.pressed("confirm") || api.input.pressed("back");
      const tapped = readsScreenGesture(state, api);
      if (left || tapped) openMenu(state, "title");
      return;
    }
    case "paused":
      // `Escape` raises `back` and `pause` on the one frame, and the paused
      // screen reads both BEFORE the menu's own edges, so a frame carrying
      // either resumes once and does nothing else (`specs/ui.md`). Both edges
      // are read so neither is left armed for the frame after.
      if (readsResume(api)) {
        enterPlay(state);
        return;
      }
      readMenu(state, api, PAUSE_ITEMS.length, (index) => {
        if (index === 0) enterPlay(state);
        else if (index === 1) beginDive(state);
        else toTitle(state);
      });
      return;
    case "gameover":
      readMenu(
        state,
        api,
        GAMEOVER_ITEMS.length,
        (index) => {
          if (index === 0) beginDive(state);
          else toTitle(state);
        },
        () => toTitle(state),
      );
      return;
    case "countdown":
    case "cleared":
      return;
  }
}

/**
 * Arrive at a screen with a menu, with the item that screen opens on selected.
 *
 * The pause menu and the game-over menu open on their first item; the title
 * opens on the entry `titleIndex` remembers (`specs/ui.md`). A gesture half-made
 * on the menu being left cannot carry across.
 */
function openMenu(state: FathomState, screen: Screen): void {
  state.screen = screen;
  state.menu = screen === "title" ? state.titleIndex : 0;
  state.pressedItem = null;
}

/** What a press on a screen with no item regions is remembered as. */
const SCREEN_PRESS = 0;

/**
 * A gesture completed on a screen that shows no menu: a pointer pressed and
 * released on it, or a contact landed and lifted on it (`specs/ui.md`).
 *
 * The screen carries no item regions, so the press is remembered as
 * `SCREEN_PRESS` rather than as an item, and the release completes the gesture
 * wherever on the screen it lands.
 */
function readsScreenGesture(state: FathomState, api: TickApi): boolean {
  let tapped = false;
  for (const sample of api.input.pointer()) {
    if (sample.type === "down") {
      state.pressedItem = SCREEN_PRESS;
      continue;
    }
    if (sample.type !== "up") continue;
    if (state.pressedItem === SCREEN_PRESS) tapped = true;
    state.pressedItem = null;
  }
  return tapped;
}

/**
 * The vocabulary every menu shares: the pointer and the finger over the items,
 * `up` and `down` by one with a wrap at both ends, and `confirm`.
 *
 * The pointer is read FIRST, because a gesture selects the item it is over
 * before it confirms one (`specs/ui.md`) and the confirm it raises acts on the
 * selection it just made.
 */
function readMenu(
  state: FathomState,
  api: TickApi,
  count: number,
  confirm: (index: number) => void,
  back?: () => void,
): void {
  const clicked = readMenuPointer(state, api, count);
  if (clicked !== null) {
    confirm(clicked);
    return;
  }
  if (api.input.pressed("up")) state.menu = (state.menu + count - 1) % count;
  if (api.input.pressed("down")) state.menu = (state.menu + 1) % count;
  if (api.input.pressed("confirm")) {
    confirm(state.menu);
    return;
  }
  if (back !== undefined && api.input.pressed("back")) back();
}

/**
 * The pointer and the finger over the current menu: what they selected, and
 * whether they confirmed anything (`specs/ui.md`).
 *
 * A sample that lands on an item selects it, which is what makes a mouse move
 * select and a contact select on its landing, since a finger never hovers. A
 * confirm requires both of its edges inside ONE item's region, so the release
 * confirms only where it lands on the item the press landed on: two edges in
 * different regions, and an edge outside every region, confirm nothing.
 *
 * Returns the item a gesture confirmed, or `null` where none did.
 */
function readMenuPointer(
  state: FathomState,
  api: TickApi,
  count: number,
): number | null {
  let confirmed: number | null = null;
  for (const sample of api.input.pointer()) {
    const over = itemAt(state.screen, sample.x, sample.y);
    if (over !== null && over < count) state.menu = over;
    if (sample.type === "down") {
      state.pressedItem = over;
      continue;
    }
    if (sample.type !== "up") continue;
    if (over !== null && over === state.pressedItem) confirmed = over;
    state.pressedItem = null;
  }
  return confirmed;
}

/** Whether this frame carried either of the two controls that resume a pause. */
function readsResume(api: TickApi): boolean {
  const pause = api.input.pressed("pause");
  const back = api.input.pressed("back");
  return pause || back;
}

/** Live play reads the four movement actions held, plus four press edges. */
function readPlay(state: FathomState, api: TickApi): void {
  state.desired = readDesired(state, api);
  if (api.input.pressed("a")) firePulse(state);
  if (api.input.pressed("b")) releaseInk(state);
  if (api.input.pressed("pause")) openMenu(state, "paused");
}

/**
 * The forager's desired direction.
 *
 * A fresh press replaces it, so the most recent movement key wins; while it is
 * still held it stays desired even once a junction it was set before arrives.
 * With no movement action held at all the forager comes to rest.
 */
function readDesired(state: FathomState, api: TickApi): Heading {
  let desired = state.desired;
  for (const d of DIRS) {
    if (api.input.pressed(d)) desired = d;
  }
  const held = DIRS.filter((d) => api.input.value(d) > 0);
  if (held.length === 0) return null;
  if (desired !== null && held.includes(desired)) return desired;
  return held[0];
}

// ---- The abilities ---------------------------------------------------------

/** Emit the forager's sonar pulse, if its cooldown has run out. */
export function firePulse(state: FathomState): void {
  if (state.sonarCooldown > 0) return;
  state.sonarCooldown = SONAR_COOLDOWN;
  raiseCue(state, "sonar");
  state.waves.push(
    new SonarWave(state.maze, {
      source: "forager",
      tint: "cyan",
      origin: state.forager.tile,
      range: sonarRange(state.depth),
      reveals: true,
      emitter: null,
    }),
  );
}

/** Release an ink cloud where the forager stands, if ink is ready. */
export function releaseInk(state: FathomState): void {
  if (state.inkCooldown > 0) return;
  state.inkCooldown = INK_COOLDOWN;
  raiseCue(state, "ink");
  state.ink.release(state.forager.x, state.forager.y);
}

/** Cast one of a Gloamfin's own pings, ordinary or the guaranteed lost-you one. */
function castPing(state: FathomState, p: Predator, lostYou: boolean): void {
  armPingTimers(p);
  raiseCue(state, "predator-ping");
  state.waves.push(
    new SonarWave(state.maze, {
      source: "gloamfin",
      tint: lostYou ? "orange" : "violet",
      origin: p.tile,
      range: GLOAMFIN_PING_RANGE,
      reveals: false,
      emitter: state.predators.indexOf(p),
    }),
  );
}

// ---- One tick --------------------------------------------------------------

/** Every body the renderer interpolates between two ticks. */
function movers(state: FathomState): Mover[] {
  return [state.forager, ...state.predators, ...state.drifters];
}

/** Stamp where everything stood as this tick begins, for the renderer to read. */
function syncView(state: FathomState): void {
  for (const m of movers(state)) m.syncView();
}

/** What the hunters reach the rest of the game through. */
function predatorWorld(state: FathomState): PredatorWorld {
  return {
    maze: state.maze,
    rng: state.rng,
    forager: state.forager,
    predators: state.predators,
    drifters: state.drifters,
    inkAt: state.ink.covers,
    inkBetween: state.ink.crosses,
    castPing: (p, lostYou) => castPing(state, p, lostYou),
    showAlert: (p) => state.effects.add(p.x, p.y, p.kind),
    playCue: (cue) => raiseCue(state, cue),
  };
}

/**
 * Advance the game by one fixed tick.
 *
 * `simTime` accumulates and the controls are read on every screen; what else
 * advances is the row of `specs/ui.md` the current screen sits on.
 */
export function tick(state: FathomState, api: TickApi, dt: number): void {
  syncView(state);
  state.simTime += dt;
  readControls(state, api);

  switch (state.screen) {
    case "countdown":
      state.countdown = Math.max(0, state.countdown - dt);
      // The light the forager casts still falls on the maze around it while the
      // countdown holds; nothing else moves.
      lightTheDark(state);
      if (state.countdown <= 0) enterPlay(state);
      break;
    case "cleared":
      state.clearedTimer = Math.max(0, state.clearedTimer - dt);
      if (state.clearedTimer <= 0) descend(state);
      break;
    case "playing":
      stepPlay(state, dt);
      break;
    default:
      break;
  }

  flushCues(state, api);
}

/** One tick of live play, in the order the systems depend on one another. */
function stepPlay(state: FathomState, dt: number): void {
  runDownTimers(state, dt);
  moveForager(state, dt);
  if (grazeTile(state)) return;

  state.ink.update(dt);
  stepPredators(state, dt);
  stepDrifters(state, dt);
  stepWaves(state, dt);
  state.effects.update(dt);
  lightTheDark(state);

  checkContact(state);
}

/** Below this a timer has run out, whatever float residue it is carrying. */
const TIMER_FLOOR = 1e-6;

/**
 * A timer `dt` seconds further down, and exactly `0` once it has run out.
 *
 * The floor is what makes a whole number of seconds a whole number of ticks: a
 * timer stepped down by `TICK_DT` a hundred and eighty times lands a few float
 * ulps above zero rather than on it, and without the floor that residue buys the
 * timer one more tick than the specification gives it.
 */
function runDown(seconds: number, dt: number): number {
  const left = seconds - dt;
  return left <= TIMER_FLOOR ? 0 : left;
}

/** The cooldowns, and the brightness hold that stands before the decay. */
function runDownTimers(state: FathomState, dt: number): void {
  state.sonarCooldown = runDown(state.sonarCooldown, dt);
  state.inkCooldown = runDown(state.inkCooldown, dt);

  const forager = state.forager;
  if (forager.hold > 0) {
    forager.hold = runDown(forager.hold, dt);
    return;
  }
  forager.brightness *= Math.pow(0.5, dt / BRIGHT_HALFLIFE);
  // A halving curve never reaches zero, and a brightness that is a millionth of
  // a unit is a light nothing can hunt by.
  if (forager.brightness < 0.0005) forager.brightness = 0;
}

/** The forager travels while a movement action is held, and rests when none is. */
function moveForager(state: FathomState, dt: number): void {
  advance(
    state.forager,
    dt,
    state.maze,
    () => state.desired,
    (c, r) => state.maze.isCorridor(c, r),
  );
}

/**
 * Eat whatever is on the forager's tile. Returns true when the maze was cleared
 * by it, which ends the tick: the screen the rest of it would run on is gone.
 */
function grazeTile(state: FathomState): boolean {
  const forager = state.forager;
  const key = tileKey(forager.col, forager.row);
  if (state.plankton[key]) {
    state.plankton[key] = false;
    state.planktonRemaining -= 1;
    state.score += SCORE_PLANKTON;
    forager.brightness = Math.min(1, forager.brightness + BRIGHT_PER_EAT);
    forager.hold = BRIGHT_HOLD;
    raiseCue(state, "eat");
    if (state.planktonRemaining <= 0) {
      clearMaze(state);
      return true;
    }
  }

  const before = state.drifters.length;
  state.drifters = state.drifters.filter(
    (d) => d.col !== forager.col || d.row !== forager.row,
  );
  const eaten = before - state.drifters.length;
  if (eaten > 0) {
    state.score += SCORE_DRIFTER * eaten;
    raiseCue(state, "eat");
  }
  return false;
}

/**
 * Every hunter's own step, each taken or not on its own mind.
 *
 * A hunter whose mind is off senses nothing and decides nothing, so nothing is
 * carried out and it holds exactly where it stands. The windows its body is
 * drawn for — its sonar mark and its detection alert — are presentation rather
 * than sense, so they keep running down either way. Its travel is gated one
 * level down, inside the step, so a hunter that has its mind but not its travel
 * runs that mind in full and only holds its body.
 */
function stepPredators(state: FathomState, dt: number): void {
  const world = predatorWorld(state);
  for (const p of state.predators) {
    if (p.mind) updatePredator(p, dt, world);
    else decayPredatorTimers(p, dt);
  }
}

/** The bonus drifters: their wander, and the cadence that admits them. */
function stepDrifters(state: FathomState, dt: number): void {
  const canEnter = (c: number, r: number): boolean =>
    state.maze.isCorridor(c, r);
  for (const d of state.drifters) {
    // Its wander is its mind and carrying that wander out is its travel, so
    // either faculty off leaves it at rest on the tile it stands on.
    if (!d.mind || !d.travel) {
      d.dir = null;
      continue;
    }
    advance(
      d,
      dt,
      state.maze,
      () => wanderDir(d, state.maze, state.rng, canEnter),
      canEnter,
    );
  }

  // The timer runs only while the maze has room and while plankton remain, so a
  // freed slot refills after a whole fresh interval rather than the instant one
  // is eaten, and a maze with nothing left to graze banks no admission up.
  if (state.drifters.length >= DRIFTER_MAX || state.planktonRemaining <= 0) {
    return;
  }
  state.drifterTimer -= dt;
  if (state.drifterTimer > 0) return;
  state.drifterTimer = DRIFTER_INTERVAL;
  admitDrifter(state);
}

/**
 * Admit one drifter at the den gate. A layout with no gate has nowhere to admit
 * one from and admits none.
 */
function admitDrifter(state: FathomState): void {
  const gate = state.maze.gate;
  if (gate === null) return;
  const mouth = { col: gate.col, row: gate.row - 1 };
  if (!state.maze.isCorridor(mouth.col, mouth.row)) return;
  state.drifters.push(new Drifter(mouth.col, mouth.row, DRIFTER_SPEED));
}

/**
 * Advance every wavefront in flight: reveal what the forager's pulse sweeps
 * over, and hand out the fixes a front carries as it arrives.
 */
function stepWaves(state: FathomState, dt: number): void {
  for (const wave of state.waves) {
    const crossed = wave.advance(dt);
    if (wave.reveals) {
      for (const bucket of crossed) {
        for (const cell of bucket) revealCorridor(state, cell);
      }
    }
    senseWithWave(state, wave);
  }
  state.waves = state.waves.filter((wave) => !wave.done);
}

/** A flooded tile and the rock bounding it, so a passage is drawn as a passage. */
function revealCorridor(state: FathomState, cell: Cell): void {
  state.fog.reveal(cell.col, cell.row);
  for (const n of state.maze.neighbors(cell.col, cell.row)) {
    if (state.maze.isRock(n.col, n.row)) state.fog.reveal(n.col, n.row);
  }
}

/**
 * What a front does as it arrives somewhere.
 *
 * The forager's pulse marks the hunters it sweeps over and is HEARD by a
 * Gloamfin it reaches; a Gloamfin's own ping carries its sound outward and
 * catches the forager when the front arrives, at most once.
 */
function senseWithWave(state: FathomState, wave: SonarWave): void {
  const world = predatorWorld(state);
  if (wave.reveals) {
    state.predators.forEach((p, index) => {
      if (p.state === "den" || wave.sweptPredators.has(index)) return;
      if (!wave.reached(p.col, p.row)) return;
      wave.sweptPredators.add(index);
      // A pulse marks the Gloamfin and the Flarefish. The Lanternjaw is an
      // amber-light creature, so a pulse leaves it exactly as it was.
      if (p.kind !== "lanternjaw") {
        p.markT = Math.max(p.markT, SONAR_MARK_TIME);
      }
      if (p.kind === "gloamfin" && p.mind) {
        acquire(p, world, state.forager.tile);
      }
    });
    return;
  }

  if (wave.caughtForager || wave.emitter === null) return;
  const emitter = state.predators[wave.emitter];
  if (emitter === undefined || emitter.state === "den") return;
  if (!wave.reached(state.forager.col, state.forager.row)) return;
  wave.caughtForager = true;
  if (emitter.mind) acquire(emitter, world, state.forager.tile);
}

/**
 * Gather everything lit this instant: the forager's own pocket, the crest of
 * every pulse still washing down the corridors, and the disc of every bloom
 * burning. A tile a source touches is lit now and remembered from here on.
 */
function lightTheDark(state: FathomState): void {
  state.fog.clearLit();
  state.fog.lightPocket(
    state.maze,
    state.forager.x,
    state.forager.y,
    visionRadius(state),
  );
  for (const wave of state.waves) {
    if (!wave.reveals) continue;
    lightCrest(state, wave);
  }
  for (const p of state.predators) {
    if (isBlooming(p)) state.fog.lightDisc(p.x, p.y, FLARE_RADIUS);
  }
}

/** The band of tiles a pulse's crest still stands over, which reads as light. */
function lightCrest(state: FathomState, wave: SonarWave): void {
  for (let d = 0; d < wave.buckets.length; d += 1) {
    const behind = wave.front - d;
    if (behind < 0 || behind > PULSE_BAND) continue;
    for (const cell of wave.buckets[d]) {
      state.fog.lightGround(cell.col, cell.row);
      for (const n of state.maze.neighbors(cell.col, cell.row)) {
        if (state.maze.isRock(n.col, n.row))
          state.fog.lightGround(n.col, n.row);
      }
    }
  }
}

/** Contact with a predator on the forager's own tile costs a life. */
function checkContact(state: FathomState): void {
  for (const p of state.predators) {
    if (p.state === "den") continue;
    if (p.col !== state.forager.col || p.row !== state.forager.row) continue;
    loseLife(state);
    return;
  }
}

// ---- The game the runtime drives -------------------------------------------

/**
 * Bind the game to the art it draws from.
 *
 * The art is loaded before the runtime is built, so `initialize` stays the one
 * synchronous call that produces the whole state.
 */
export function createFathom(assets: Assets): Game<FathomState> {
  return {
    initialize(api: InitApi): FathomState {
      for (const [action, keys] of Object.entries(BINDINGS)) {
        api.input.register(action, keys);
      }
      defineCues(api);
      const state = createState(assets);
      registerDiagnostics(api, state);
      return state;
    },
    tick,
    render(state: FathomState, api: RenderApi): void {
      render(state, api.ctx, api.alpha);
    },
  };
}
