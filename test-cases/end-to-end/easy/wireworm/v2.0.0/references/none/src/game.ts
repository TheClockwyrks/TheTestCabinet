// Wireworm — the game: the state it is built on, the screens it moves between,
// the per-frame update, and the three functions the runtime drives.
//
// A `Game<S>` is three functions and a state type. `initialize` runs once, when
// the runtime is initialized, and returns the state. `update` and `render` then
// run once each per frame — `update` first, with the frame's delta time in
// SECONDS, then `render`. The state is the only channel between them.
//
// There is no fixed timestep here and no accumulator over one. Every rate in
// `src/constants.ts` is per second and is multiplied by `dt`, so the same second
// of play reaches the same state whether it arrived as one long step, as sixty
// short ones, or as an uneven mixture. The one clocked quantity is the worm's
// tile step, which carries its own accumulator and its own remainder, exactly as
// `specs/worm.md` states — and which is therefore just as insensitive to how the
// second was divided.
//
// THE UPDATE'S ORDER IS PART OF THE DESIGN. The cursor moves, then the bolts
// already in flight travel and resolve, then a held fire action puts a new bolt
// in the air — so a bolt is never moved on the frame it was created and the
// muzzle a check reads is where the shot began. The worms step next, the foes
// after them, and the contact test last, with a guard after each: a life lost
// mid-frame empties the board, and nothing that follows should run against a
// board that is no longer there.

import {
  BONUS_LIFE_EVERY,
  CUES,
  DEFAULT_SEED,
  ENDING_ITEMS,
  PAUSE_ITEMS,
  START_LIVES,
  TITLE_ITEMS,
  wormStepInterval,
} from "./constants";
import type { Sprites } from "./assets";
import { defineCues } from "./audio";
import { checkContact, clampCursor, moveCursor, updateFiring } from "./cursor";
import { registerDiagnostics } from "./diagnostics";
import { emptyField } from "./field";
import { updateFoes } from "./foes";
import {
  back,
  confirm,
  firing,
  menuDown,
  menuUp,
  moveAxis,
  mute,
  pause,
  registerActions,
} from "./input";
import {
  BAND_CENTER_X,
  BAND_CENTER_Y,
  advancePhase,
  startRun,
  toTitle,
} from "./progression";
import { renderGame } from "./render";
import type { Game, InitApi, RenderApi, UpdateApi } from "./runtime";
import { updateBolts } from "./shots";
import type { CueSink, WirewormState } from "./types";
import { stepWorm } from "./worm";

/** The whole state, at its title-screen values. */
export function createInitialState(): WirewormState {
  return {
    screen: "title",
    phase: "banner",
    phaseTimer: 0,
    menuIndex: 0,

    score: 0,
    lives: START_LIVES,
    level: 1,
    reachedLevel: 1,
    nextBonus: BONUS_LIFE_EVERY,

    field: emptyField(),
    worms: [],
    foes: [],
    bolts: [],
    arcs: [],

    cursor: {
      x: BAND_CENTER_X,
      y: BAND_CENTER_Y,
      invulnerable: 0,
      contact: true,
    },
    fireCooldown: 0,

    foeSpawning: true,
    wormEntry: true,
    glitchTimer: 0,
    corruptorTimer: 0,
    dropperTimer: 0,

    nextId: 1,
    simTime: 0,
    muted: false,
    rngState: DEFAULT_SEED,
  };
}

/**
 * Restore every declared field to its title-screen value and reseed the
 * generator (specs/instrumentation.md).
 *
 * `muted` is deliberately untouched: muting is a player preference the runtime
 * owns, and a reset is not a reason to start making noise again. The clock is
 * untouched for the same kind of reason — whether the game is stepping itself is
 * said with `setAutoStep`, not with a reset.
 */
export function resetState(state: WirewormState, seed: number): void {
  const fresh = createInitialState();
  fresh.rngState = seed;
  fresh.muted = state.muted;
  Object.assign(state, fresh);
}

/** Whether live play is running this frame. */
function live(state: WirewormState): boolean {
  return state.screen === "playing" && state.phase === "active";
}

/** Move a menu highlight, wrapping at both ends, and take a confirmed item. */
function driveMenu(
  state: WirewormState,
  api: UpdateApi,
  cues: CueSink,
  count: number,
  onConfirm: (index: number) => void,
): void {
  const up = menuUp(api);
  const down = menuDown(api);
  const accepted = confirm(api);
  if (up) {
    state.menuIndex = (((state.menuIndex - 1) % count) + count) % count;
    cues.play(CUES.menu);
  } else if (down) {
    state.menuIndex = (((state.menuIndex + 1) % count) + count) % count;
    cues.play(CUES.menu);
  } else if (accepted) {
    onConfirm(state.menuIndex);
  }
}

/** Read this frame's edges and act on them, by screen. */
export function handleInput(
  state: WirewormState,
  api: UpdateApi,
  cues: CueSink,
): void {
  // Mute answers from any screen, and is the runtime's bit rather than a field
  // of the state: the snapshot reports it, and no operation poses it.
  if (mute(api)) api.audio.setMuted(!api.audio.muted());

  switch (state.screen) {
    case "title":
      driveMenu(state, api, cues, TITLE_ITEMS.length, (index) => {
        if (index === 0) startRun(state);
        else {
          state.screen = "howto";
          state.menuIndex = 0;
        }
      });
      return;

    case "howto":
      if (back(api) || confirm(api)) toTitle(state);
      return;

    case "playing":
      if (pause(api)) {
        state.screen = "paused";
        state.menuIndex = 0;
      }
      return;

    case "paused": {
      // `Escape` drives both `back` and `pause`, and on this screen both do what
      // RESUME does, so both edges are read before the menu is.
      const leaving = back(api) || pause(api);
      if (leaving) {
        state.screen = "playing";
        state.menuIndex = 0;
        return;
      }
      driveMenu(state, api, cues, PAUSE_ITEMS.length, (index) => {
        if (index === 0) {
          state.screen = "playing";
          state.menuIndex = 0;
        } else if (index === 1) startRun(state);
        else toTitle(state);
      });
      return;
    }

    case "victory":
    case "gameover":
      driveMenu(state, api, cues, ENDING_ITEMS.length, (index) => {
        if (index === 0) startRun(state);
        else toTitle(state);
      });
      return;
  }
}

/**
 * Step every worm whose clock has reached the level's interval, in order, with
 * the remainder carried into the next frame.
 *
 * The contact test runs after each individual step rather than once at the end
 * of the frame, because a frame long enough to cover several intervals can walk
 * a segment through the cursor and out the other side, and the life it costs is
 * owed to the step it happened on.
 */
export function updateWorms(
  state: WirewormState,
  dt: number,
  cues: CueSink,
): void {
  const interval = wormStepInterval(state.level);
  for (const worm of [...state.worms]) {
    // A worm whose step is gated does not accumulate either, so turning the gate
    // back on resumes the cadence rather than firing a burst of owed steps.
    if (!worm.stepping) continue;
    worm.stepClock += dt;
    while (worm.stepClock >= interval) {
      worm.stepClock -= interval;
      stepWorm(state, worm, cues);
      checkContact(state, cues);
      if (!live(state)) return;
    }
  }
}

/** Count every live arc's remaining life down and drop the ones that expired. */
function decayArcs(state: WirewormState, dt: number): void {
  if (state.arcs.length === 0) return;
  for (const arc of state.arcs) arc.life -= dt;
  state.arcs = state.arcs.filter((arc) => arc.life > 0);
}

/** Advance the simulation by `dt` seconds of elapsed time. */
export function advance(
  state: WirewormState,
  api: UpdateApi,
  dt: number,
  cues: CueSink,
): void {
  // Simulation time accumulates whatever the screen, so a run left alone on the
  // title screen is still on the same clock as one being played.
  state.simTime += dt;
  // The arcs of a discharge are part of the board, and the board is frozen only
  // while the game is paused, so they run down on every other screen: a
  // detonation that ended the run does not leave its lightning hanging.
  if (state.screen !== "paused") decayArcs(state, dt);
  if (state.screen !== "playing") return;

  if (state.cursor.invulnerable > 0) {
    state.cursor.invulnerable = Math.max(0, state.cursor.invulnerable - dt);
  }

  // The banner and the respawn run their timers and nothing else; each brings in
  // the level's worm as it gives way to live play.
  if (!advancePhase(state, dt)) return;

  moveCursor(state, moveAxis(api), dt);
  updateBolts(state, dt, cues);
  if (!live(state)) return;
  updateFiring(state, firing(api), dt, cues);
  updateWorms(state, dt, cues);
  if (!live(state)) return;
  updateFoes(state, dt, cues);
  if (!live(state)) return;
  checkContact(state, cues);
}

/**
 * Build the game the runtime drives, over the sprite art the page already
 * decoded.
 *
 * The art is handed in rather than reached for, so the game holds no global and
 * a test can stand the same game up over frames it decoded itself.
 */
export function createGame(sprites: Sprites): Game<WirewormState> {
  return {
    initialize(api: InitApi): WirewormState {
      registerActions(api);
      defineCues(api);
      const state = createInitialState();
      // Registered after the state is built, because every source is a pure read
      // of that object — and it is the object every later frame is handed, so the
      // overlay reports the live game rather than a snapshot of its opening.
      registerDiagnostics(api, state);
      // A cursor posed by a test, or a state carried across a reload, is held to
      // the band exactly as a played one is.
      clampCursor(state.cursor);
      return state;
    },

    update(state: WirewormState, api: UpdateApi, dt: number): void {
      handleInput(state, api, api.audio);
      advance(state, api, dt, api.audio);
      // The runtime owns the mute bit; this is the game's readable copy of it,
      // so the HUD hint and the snapshot cannot drift from what a player hears.
      state.muted = api.audio.muted();
    },

    render(state: WirewormState, api: RenderApi): void {
      renderGame(state, api.ctx, sprites);
    },
  };
}
