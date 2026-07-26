// Floe — the debugging and automation API installed on window.__floe.
//
// A thin surface over the exact game the UI drives: it advances the real
// fixed-timestep simulation (game.fixedStep) and reads the real state
// (game.debugSnapshot), so a scenario driven from code behaves identically to one
// played by hand. It only sets up situations and steps the real systems forward;
// it never fabricates an outcome. See specs/instrumentation.md.

import { FIXED_STEP } from "./constants";
import type { FloeSnapshot, Game } from "./game";

interface LaneSpecInput {
  cols: number[];
  speed?: number;
  dir?: 1 | -1;
}

interface BearStateInput {
  col: number;
  row: number;
}

export interface FloeDebugApi {
  version: number;
  reset(options?: { seed?: number }): void;
  /** Advance the sim by exactly `ticks` fixed steps (1 tick = 1/120 s). */
  step(ticks: number): void;
  setAutoStep(enabled: boolean): void;
  snapshot(): FloeSnapshot;
  startGame(): void;
  setLevel(level: number): void;
  setLives(count: number): void;
  setScore(points: number): void;
  setTimer(seconds: number): void;
  setBays(filled: boolean[]): void;
  placeCritter(col: number, row: number): void;
  setLane(row: number, spec: LaneSpecInput): void;
  setBear(index: number, state: BearStateInput | null): void;
  keyDown(code: string): void;
  keyUp(code: string): void;
  press(code: string): void;
}

export function installDebugApi(game: Game): void {
  const api: FloeDebugApi = {
    version: 1,

    // Return to the title, reseeding all randomness so a scenario replays
    // identically. The base variant's only randomness is the bonus-catch fish's
    // bay choice. This also switches the game to manual stepping (the animation
    // loop stops advancing the sim from the wall clock), so from here step() is the
    // only thing that moves the simulation and a scripted scenario is exact.
    reset(options) {
      game.debugReset(options?.seed);
      game.autoStep = false;
    },

    // Advance the real simulation without waiting on real time. The unit is whole
    // simulation ticks, not seconds: the game runs a fixed 120 Hz timestep
    // (FIXED_STEP), so one tick is 1/120 s and step(120) is a second of game time.
    // Ticks are the honest unit for a fixed-timestep sim — a seconds argument has
    // to be rounded to a whole number of steps, which silently moves the sim a
    // different distance than the caller asked for and means something different
    // at every simulation rate. So there is no rounding here, and a fractional or
    // negative count is a caller mistake to surface rather than to guess at.
    //
    // On a menu screen the fixed step is a no-op. Stepping also switches the game
    // to manual clocking, so the animation loop no longer advances the sim on its
    // own and these are the exact steps that pass — no stray wall-clock frames.
    step(ticks) {
      if (!Number.isInteger(ticks) || ticks < 0) {
        throw new Error(
          `__floe.step(ticks): expected a non-negative whole number of simulation ticks (1 tick = 1/120 s), received ${String(ticks)}`,
        );
      }
      game.autoStep = false;
      for (let i = 0; i < ticks; i++) game.fixedStep(FIXED_STEP);
    },

    // Hand the clock back to (or take it from) the animation loop. setAutoStep(true)
    // lets the game advance itself in real time again — useful for watching a
    // scenario play out or recording a live motion clip; setAutoStep(false) returns
    // to manual stepping via step(). reset() and step() also switch to manual.
    setAutoStep(enabled) {
      game.autoStep = Boolean(enabled);
    },

    snapshot() {
      return game.debugSnapshot();
    },

    startGame() {
      game.debugStartGame();
    },

    setLevel(level) {
      game.debugSetLevel(level);
    },

    setLives(count) {
      game.debugSetLives(count);
    },

    setScore(points) {
      game.debugSetScore(points);
    },

    setTimer(seconds) {
      game.debugSetTimer(seconds);
    },

    setBays(filled) {
      game.debugSetBays(filled);
    },

    placeCritter(col, row) {
      game.debugPlaceCritter(col, row);
    },

    setLane(row, spec) {
      game.debugSetLane(row, spec);
    },

    setBear(index, state) {
      game.debugSetBear(index, state);
    },

    // Inject keyboard input through the very same path the real keyboard feeds
    // (a dispatched KeyboardEvent the Input listener catches), so held movement
    // and edge actions behave exactly as a player's keypress would. This does NOT
    // take control away from normal play — a movement key hops the critter
    // through the game's own play code — so a caller can confirm the controls
    // themselves work.
    keyDown(code) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code }));
      // Apply any one-shot edge action (menu move, confirm, pause, mute, overlay
      // toggle) at once, so a caller need not wait for a render frame.
      game.handleInput();
    },

    keyUp(code) {
      window.dispatchEvent(new KeyboardEvent("keyup", { code }));
    },

    press(code) {
      this.keyDown(code);
      this.keyUp(code);
    },
  };

  (window as unknown as { __floe?: FloeDebugApi }).__floe = api;
}
