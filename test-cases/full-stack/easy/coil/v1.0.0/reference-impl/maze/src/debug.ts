// Coil — the debugging and automation API installed on window.__coil (specs/instrumentation.md).
//
// A thin surface over the exact game the UI drives: it advances the real fixed-timestep
// simulation (game.step) and reads the real state (game.debugSnapshot), so a scenario driven
// from code behaves identically to one played by hand. The control operations only set up
// situations and step the real systems forward; they never fabricate an outcome. Inert during
// normal play — nothing runs until something calls it.

import { TICK_DT } from "./constants";
import type { CoilSnapshot, Game } from "./game";
import type { Cell, Dir } from "./sim";

export interface CoilDebugApi {
  version: number;
  reset(options?: { seed?: number }): void;
  step(seconds: number): void;
  snapshot(): CoilSnapshot;
  setAutoStep(enabled: boolean): void;
  startRound(): void;
  setSnake(cells: Cell[], dir: Dir): void;
  setPellet(cell: Cell): void;
  setCombo(multiplier: number, windowSeconds: number): void;
  setScore(points: number): void;
  keyDown(code: string): void;
  keyUp(code: string): void;
  press(code: string): void;
}

export function installDebugApi(game: Game): void {
  const api: CoilDebugApi = {
    version: 1,

    reset(options) {
      game.reset(options);
    },

    // Advance the real simulation by `seconds`, in whole 125 ms ticks, without waiting on
    // real frames. Only a live round advances.
    step(seconds) {
      const ticks = Math.max(0, Math.round(seconds / TICK_DT));
      game.step(ticks);
    },

    snapshot() {
      return game.debugSnapshot();
    },

    setAutoStep(enabled) {
      game.setAutoStep(Boolean(enabled));
    },

    startRound() {
      game.start();
    },

    setSnake(cells, dir) {
      game.debugSetSnake(cells, dir);
    },

    setPellet(cell) {
      game.debugSetPellet(cell);
    },

    setCombo(multiplier, windowSeconds) {
      game.debugSetCombo(multiplier, windowSeconds);
    },

    setScore(points) {
      game.debugSetScore(points);
    },

    // Inject keyboard input through the very same listener the real keyboard feeds (a
    // dispatched KeyboardEvent), then apply the drained edge input at once so a caller need
    // not wait for a render frame to see a one-shot action take effect.
    keyDown(code) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code }));
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

  (window as unknown as { __coil?: CoilDebugApi }).__coil = api;
}
