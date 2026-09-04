// Shatter — the game itself: the state machine, one tick, and what the frame loop
// asks of it.
//
// This file is the `Game<ShatterState>` the runtime drives (`src/runtime.ts`). It
// owns three things and delegates everything else:
//
//   * THE FIXED STEP. `specs/simulation.md` puts the timestep in the game rather
//     than in the runtime: the loop measures how much real time a frame covered
//     and hands it over, and the game runs whole `TICK_DT` ticks and carries the
//     remainder into the next frame. So an interval of game time reaches the same
//     state however it was divided into frames, which is what makes a driven
//     scenario reproducible on any machine.
//   * THE ORDER INSIDE ONE TICK. `specs/simulation.md` fixes it — control forces,
//     the star's pull, velocity, position, the wrap, then collision — and
//     {@link stepPlaying} is that list, in that order, with each line a call into
//     the system that owns it.
//   * THE SCREENS. Which screen the game is on, which of the actions that screen
//     answers to, and where each menu entry leads (`specs/ui.md`).
//
// Everything else is in the system that owns it: `src/ship.ts`, `src/weapons.ts`,
// `src/rocks.ts`, `src/shots.ts`, `src/saucer.ts`, `src/collision.ts`,
// `src/waves.ts`, and the run itself in `src/world.ts`.

import {
  CUES,
  DEFAULT_SEED,
  GAMEOVER_ITEMS,
  PAUSE_ITEMS,
  TICK_DT,
  TITLE_ITEMS,
  type CueName,
} from "./constants";
import { defineCues } from "./audio";
import { resolveCollisions } from "./collision";
import { registerDiagnostics } from "./diagnostics";
import { registerActions } from "./input";
import { renderGame } from "./render";
import type { Game, InitApi, RenderApi, UpdateApi } from "./runtime";
import { integrateRocks } from "./rocks";
import {
  integrateSaucer,
  saucerArrival,
  saucerControl,
  saucerGun,
  tickSaucerLifetime,
} from "./saucer";
import { integrateShip, shipControl, tickInvulnerability } from "./ship";
import { integrateBullets, integrateEnemyBullets } from "./shots";
import type { ShatterState } from "./types";
import {
  handleWeaponInput,
  integrateTorpedoes,
  tickFireGate,
  tickTorpedoCharge,
  torpedoControl,
} from "./weapons";
import { stepWaves } from "./waves";
import { createState, startNewGame, toTitle } from "./world";

/**
 * One whole simulation tick.
 *
 * The screen input is read first, because a tick that pauses the game should not
 * also advance it, and `simTime` accumulates last and unconditionally: it counts
 * the ticks the game ran rather than the play it ran, which is what `specs/ui.md`
 * fixes for the paused screen.
 */
function runTick(state: ShatterState, api: UpdateApi): void {
  state.cues.length = 0;
  state.rockDestroyed = false;

  handleScreenInput(state, api);
  if (state.screen === "playing") stepPlaying(state, api);

  state.simTime += TICK_DT;
  state.muted = api.audio.muted();
  playCues(state, api);
  // The one held cue: it sounds for exactly as long as thrust is being applied,
  // and a game that is not being played is not thrusting.
  api.audio.setHeld(
    CUES.thrust,
    state.screen === "playing" && state.ship.thrusting,
  );
}

/**
 * One tick of live play, in the order `specs/simulation.md` fixes.
 *
 * The weapons are read at the END, after the field has moved and its collisions
 * have been resolved, so a round created by this tick has not also been flown by
 * it — which is what puts a fresh shot at the ship's nose rather than a tick's
 * travel beyond it.
 */
function stepPlaying(state: ShatterState, api: UpdateApi): void {
  // 1. Control forces: the ship turns and takes its thrust, the saucer steers,
  //    and a torpedo turns onto whatever it has acquired.
  const force = shipControl(state, api);
  saucerControl(state);
  torpedoControl(state);

  // 2-5. The star's pull, the velocity it and the control forces reach, the
  //      travel that follows, and the wrap. Each system applies the pull only if
  //      `specs/gravity.md` says its body is pulled at all.
  integrateShip(state, force);
  integrateBullets(state);
  integrateRocks(state);
  integrateEnemyBullets(state);
  integrateTorpedoes(state);
  integrateSaucer(state);

  // 6. Every impact the motion above made.
  resolveCollisions(state);

  // The clocks the rules above run on.
  tickInvulnerability(state);
  state.extraLifeShow = Math.max(0, state.extraLifeShow - TICK_DT);
  saucerGun(state);
  tickSaucerLifetime(state);
  stepWaves(state);
  saucerArrival(state);

  // What the player asked the ship to shoot.
  tickFireGate(state);
  tickTorpedoCharge(state);
  handleWeaponInput(state, api);
}

/** Play each cue the tick raised, once, whatever raised it twice. */
function playCues(state: ShatterState, api: UpdateApi): void {
  const played: CueName[] = [];
  for (const cue of state.cues) {
    if (played.includes(cue)) continue;
    played.push(cue);
    api.audio.play(cue);
  }
}

/** Move a menu selection by `delta`, wrapping at both ends of `count` entries. */
function moveMenu(state: ShatterState, count: number, delta: number): void {
  const at = ((state.menuIndex % count) + count) % count;
  state.menuIndex = (at + delta + count) % count;
}

/** Read this tick's menu moves for a screen showing `count` entries. */
function menuNavigation(
  state: ShatterState,
  api: UpdateApi,
  count: number,
): void {
  // Both edges are read and neither is short-circuited: one left unconsumed
  // would be discarded at the end of the frame anyway, and reading both keeps
  // this tick's input fully accounted for.
  const up = api.input.pressed("menu-up");
  const down = api.input.pressed("menu-down");
  if (up) moveMenu(state, count, -1);
  if (down) moveMenu(state, count, 1);
}

/** Whichever entry of `count` is highlighted, brought into range. */
function highlighted(state: ShatterState, count: number): number {
  return ((state.menuIndex % count) + count) % count;
}

/**
 * The actions the current screen answers to.
 *
 * Mute is read first and on every screen, because `specs/controls.md` binds it
 * from any screen. Everything below it is the screen's own.
 */
function handleScreenInput(state: ShatterState, api: UpdateApi): void {
  if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());

  switch (state.screen) {
    case "title": {
      menuNavigation(state, api, TITLE_ITEMS.length);
      if (!api.input.pressed("confirm")) return;
      if (highlighted(state, TITLE_ITEMS.length) === 0) startNewGame(state);
      else {
        // The title's highlight is left exactly as it was, so leaving `howto`
        // comes back to the entry that opened it (`specs/ui.md`).
        state.screen = "howto";
      }
      return;
    }
    case "howto": {
      // Confirming leaves this screen as leaving it does, and neither touches the
      // title's highlight or anything else the title screen holds (`specs/ui.md`).
      const leaving = api.input.pressed("confirm") || api.input.pressed("back");
      if (leaving) state.screen = "title";
      return;
    }
    case "playing": {
      if (!api.input.pressed("pause")) return;
      state.screen = "paused";
      state.menuIndex = 0;
      state.ship.thrusting = false;
      return;
    }
    case "paused": {
      // Leaving this screen and pausing again each do what RESUME does
      // (`specs/ui.md`). Both edges are read before the menu's own, and a frame
      // carrying either resumes and does nothing else (`specs/controls.md`).
      const leaving = api.input.pressed("back");
      const pausing = api.input.pressed("pause");
      if (leaving || pausing) {
        state.screen = "playing";
        return;
      }
      menuNavigation(state, api, PAUSE_ITEMS.length);
      if (!api.input.pressed("confirm")) return;
      const entry = highlighted(state, PAUSE_ITEMS.length);
      if (entry === 0) state.screen = "playing";
      else if (entry === 1) startNewGame(state);
      else toTitle(state);
      return;
    }
    case "gameover": {
      // Leaving this screen does what MENU does (`specs/ui.md`).
      if (api.input.pressed("back")) {
        toTitle(state);
        return;
      }
      menuNavigation(state, api, GAMEOVER_ITEMS.length);
      if (!api.input.pressed("confirm")) return;
      if (highlighted(state, GAMEOVER_ITEMS.length) === 0) startNewGame(state);
      else toTitle(state);
      return;
    }
  }
}

/** Shatter, as the runtime drives it. */
export const game: Game<ShatterState> = {
  initialize(api: InitApi): ShatterState {
    registerActions(api);
    defineCues(api);
    const state = createState(DEFAULT_SEED);
    registerDiagnostics(api, state);
    return state;
  },

  /**
   * Turn a frame's worth of real time into whole ticks, carrying the remainder.
   *
   * The runtime clamps the delta it hands over, so a tab that was backgrounded
   * for a minute resumes with a frame's worth of catching up rather than seven
   * thousand ticks in one go.
   */
  update(state: ShatterState, api: UpdateApi, dt: number): number {
    state.carry += dt;
    let ticks = 0;
    while (state.carry >= TICK_DT) {
      state.carry -= TICK_DT;
      runTick(state, api);
      ticks += 1;
    }
    return ticks;
  },

  tick(state: ShatterState, api: UpdateApi): void {
    runTick(state, api);
  },

  render(state: ShatterState, api: RenderApi): void {
    renderGame(state, api.ctx);
  },
};
