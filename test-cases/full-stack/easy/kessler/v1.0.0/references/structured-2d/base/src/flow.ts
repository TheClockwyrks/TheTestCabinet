// Kessler — the screens wrapped around the simulation (specs/screens.md).
//
// The six screens, the menus, the tick accumulator, and the routing of one
// action to what that action does on the screen the game is on. Only
// `playing` advances the simulation; `waveclear` advances its 180-tick
// interstitial and nothing else; the other four freeze everything. This
// module also owns the session lifecycle — a fresh session on START, the
// discard on QUIT — and the reset behind `specs/instrumentation.md`.
//
// Every function writes the world's live `KesslerState` in place and reads
// nothing from the clock or the renderer: what a tick sounds and spawns goes
// out through the same `TickHooks` the game mode binds to the world's cue bus
// and the effects layer, so a scenario driven by `engine.advance` behaves
// exactly like one played by hand.

import {
  CUES,
  DEFAULT_SEED,
  PAUSE_ITEMS,
  TICK_DT,
  TITLE_ITEMS,
  WAVECLEAR_TICKS,
  type ActionName,
  type Screen,
} from "./constants";
import { nextFloat, seedRng } from "./rng";
import { launchParkedBall, tickPlaying, type TickIo } from "./sim";
import {
  bootSession,
  clearVolatiles,
  layOutWave,
  parkFreshBall,
} from "./session";
import type { KesslerState } from "./state";

/**
 * What the flow asks of the layers around it: a cue played on its event and
 * a particle system spawned at a stage point. Structural on purpose — the
 * game mode hands in the world's cue bus and the effects layer, and a test
 * hands in a recorder.
 */
export interface TickHooks {
  cue: TickIo["cue"];
  particle: TickIo["particle"];
}

/** Hooks that sound and spawn nothing, for tests over the bare state. */
export const SILENT_HOOKS: TickHooks = {
  cue: () => undefined,
  particle: () => undefined,
};

/**
 * The slack the accumulator allows a tick boundary. A second delivered as
 * sixty frames of a sixtieth each sums to a hair under a second in binary
 * floating point, and it must resolve the same sixty ticks a second
 * delivered whole does. Far smaller than any interval a caller can mean.
 */
const TICK_EPSILON = 1e-9;

/** Enters `screen` with its top menu entry highlighted. */
function enter(state: KesslerState, screen: Screen): void {
  state.screen = screen;
  state.menuIndex = 0;
}

/**
 * Consumes the frame time `state.accumulator` holds into whole ticks,
 * carrying the remainder, so a second of game time is sixty ticks however it
 * was divided into frames (`specs/overview.md`).
 */
export function runTicks(state: KesslerState, hooks: TickHooks): void {
  while (state.accumulator >= TICK_DT - TICK_EPSILON) {
    state.accumulator -= TICK_DT;
    runOneTick(state, hooks);
  }
}

/** Resolves one whole tick of the screen the game is on. */
export function runOneTick(state: KesslerState, hooks: TickHooks): void {
  state.ticks += 1;
  if (state.screen === "playing") {
    state.simTicks += 1;
    const outcome = tickPlaying(state, tickIo(state, hooks));
    if (outcome.clearedWave !== null) {
      state.interstitialTicks = WAVECLEAR_TICKS;
      enter(state, "waveclear");
    } else if (outcome.gameOver) {
      enter(state, "gameover");
      hooks.cue(CUES.gameOver);
    }
  } else if (state.screen === "waveclear") {
    state.interstitialTicks -= 1;
    if (state.interstitialTicks <= 0) {
      beginNextWave(state);
    }
  }
}

/** The one tick's reads and hooks, bound over the live state. */
function tickIo(state: KesslerState, hooks: TickHooks): TickIo {
  return {
    held: state.held,
    rng: () => nextFloat(state),
    podSpawn: state.podSpawn,
    waveAdvance: state.waveAdvance,
    tickIndex: state.simTicks,
    cue: hooks.cue,
    particle: hooks.particle,
  };
}

/**
 * The interstitial's lapse: every slot refills, ring angles reset, the wave
 * number rises by one with the new wave's figures in force, a ball parks,
 * and play resumes (`specs/rings.md`).
 */
function beginNextWave(state: KesslerState): void {
  layOutWave(state, state.wave + 1);
  parkFreshBall(state, state.simTicks);
  enter(state, "playing");
}

// --- Actions (specs/controls.md routes them; specs/screens.md answers) ---

/**
 * One press edge of `action`, routed against `onScreen` — the screen that was
 * up when the frame began, so the `Space` that confirms START does not also
 * launch on the play screen it opens: `Space` carries both `confirm` and
 * `launch`, and the two never answer on the same screen
 * (`specs/controls.md`).
 */
export function handleAction(
  state: KesslerState,
  action: ActionName,
  onScreen: Screen,
  hooks: TickHooks,
): void {
  switch (onScreen) {
    case "title":
      menuAction(state, action, TITLE_ITEMS.length, hooks, (index) => {
        if (index === 0) startFreshSession(state);
        else enter(state, "howto");
      });
      break;
    case "howto":
      if (action === "confirm" || action === "back") enter(state, "title");
      break;
    case "playing":
      if (action === "launch") launchParkedBall(state);
      else if (action === "back" || action === "pause") {
        enter(state, "paused");
      }
      break;
    case "waveclear":
      break;
    case "paused":
      if (action === "back" || action === "pause") {
        enter(state, "playing");
        break;
      }
      menuAction(state, action, PAUSE_ITEMS.length, hooks, (index) => {
        if (index === 0) enter(state, "playing");
        else discardSession(state);
      });
      break;
    case "gameover":
      if (action === "confirm") discardSession(state);
      break;
  }
}

/** The shared menu behavior: wrap-around movement and confirm. */
function menuAction(
  state: KesslerState,
  action: ActionName,
  entries: number,
  hooks: TickHooks,
  accept: (index: number) => void,
): void {
  if (action === "up" || action === "down") {
    const delta = action === "down" ? 1 : -1;
    state.menuIndex = (state.menuIndex + delta + entries) % entries;
    hooks.cue(CUES.menuMove);
  } else if (action === "confirm") {
    hooks.cue(CUES.menuSelect);
    accept(state.menuIndex);
  }
}

// --- The session lifecycle ---

/**
 * Starts a fresh session exactly as confirming START does: the boot layout
 * with a ball parked on the deflector, the pod stream reseeded from the
 * session's seed, and the game on `playing`.
 */
export function startFreshSession(state: KesslerState): void {
  bootSession(state);
  state.rngState = seedRng(state.seed);
  parkFreshBall(state, state.simTicks);
  enter(state, "playing");
}

/** Discards the session exactly as QUIT does and returns to the title. */
export function discardSession(state: KesslerState): void {
  bootSession(state);
  enter(state, "title");
}

/**
 * Enters the wave-clear interstitial as the clearing event enters it:
 * balls, pods, timed effects, and the shield are removed and a fresh
 * interstitial begins for the wave the counter holds.
 */
export function enterWaveclear(state: KesslerState): void {
  state.balls = [];
  clearVolatiles(state);
  state.interstitialTicks = WAVECLEAR_TICKS;
  enter(state, "waveclear");
}

/**
 * Enters a screen exactly as the real transition into it does, with the
 * entering menu highlighting its top entry and no cue sounding
 * (`specs/instrumentation.md`'s `setScreen` table).
 */
export function poseScreen(state: KesslerState, name: Screen): void {
  switch (name) {
    case "playing":
      startFreshSession(state);
      break;
    case "waveclear":
      enterWaveclear(state);
      break;
    case "title":
      discardSession(state);
      break;
    default:
      enter(state, name);
      break;
  }
}

/**
 * Restores the boot state (`specs/instrumentation.md`): the title screen
 * over the boot layout, zero ticks, both driver switches on, and the pod
 * stream seeded with `seed`.
 */
export function resetState(
  state: KesslerState,
  seed: number = DEFAULT_SEED,
): void {
  state.seed = seed;
  state.rngState = seedRng(seed);
  bootSession(state);
  state.screen = "title";
  state.menuIndex = 0;
  state.ticks = 0;
  state.simTicks = 0;
  state.waveAdvance = true;
  state.podSpawn = true;
  state.interstitialTicks = 0;
  state.accumulator = 0;
  state.held.left = false;
  state.held.right = false;
  state.nextId = 0;
}
