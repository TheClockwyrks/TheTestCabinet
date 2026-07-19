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
  step(seconds: number): void;
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
    // bay choice.
    reset(options) {
      game.debugReset(options?.seed);
    },

    // Advance the real simulation by `seconds`, in whole fixed steps, without
    // waiting on real time. On a menu screen the fixed step is a no-op.
    step(seconds) {
      const steps = Math.max(0, Math.round(seconds / FIXED_STEP));
      for (let i = 0; i < steps; i++) game.fixedStep(FIXED_STEP);
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
