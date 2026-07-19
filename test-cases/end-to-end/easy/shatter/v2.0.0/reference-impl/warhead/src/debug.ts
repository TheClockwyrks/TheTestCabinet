// Shatter (Warhead) — the debugging and automation API on window.__shatter.
//
// A thin surface over the exact game the UI drives: it advances the real
// fixed-timestep simulation (game.fixedStep) and reads the real state
// (game.debugSnapshot), so a scenario driven from code behaves identically to
// one played by hand. It only arranges situations and steps the real systems
// forward; it never fabricates an outcome. See specs/instrumentation.md.

import { FIXED_STEP } from "./constants";
import type { RockSize } from "./constants";
import type { Game, ShatterSnapshot } from "./game";
import { seedRng } from "./rng";

interface ShipState {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  angle?: number;
}

interface BodyState {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface RockState extends BodyState {
  health?: number;
}

export interface ShatterDebugApi {
  version: number;
  reset(options?: { seed?: number }): void;
  step(seconds: number): void;
  setAutoStep(enabled: boolean): void;
  snapshot(): ShatterSnapshot;
  startGame(): void;
  setScore(n: number): void;
  setLives(n: number): void;
  setInvuln(seconds: number): void;
  setShip(state: ShipState): void;
  clearRocks(): void;
  addRock(size: RockSize, state?: RockState): number;
  addBullet(state?: BodyState): void;
  spawnSaucer(): void;
  setSaucer(state: BodyState): void;
  removeSaucer(): void;
  setTorpedoReady(ready: boolean): void;
  keyDown(code: string): void;
  keyUp(code: string): void;
  press(code: string): void;
}

export function installDebugApi(game: Game): void {
  const api: ShatterDebugApi = {
    version: 1,

    reset(options) {
      // Seed all of the game's randomness so a scenario replays identically,
      // then return to the title and re-arm manual stepping.
      if (options?.seed !== undefined) seedRng(options.seed);
      game.debugReset();
    },

    // Advance the real simulation by `seconds`, in whole fixed steps, without
    // waiting on real time; take the clock over (manual stepping).
    step(seconds) {
      game.autoStep = false;
      const steps = Math.max(0, Math.round(seconds / FIXED_STEP));
      for (let i = 0; i < steps; i++) game.fixedStep(FIXED_STEP);
    },

    // Hand the clock back to the game (true) so it advances itself in real time
    // for a live clip, or return to manual stepping (false).
    setAutoStep(enabled) {
      game.autoStep = Boolean(enabled);
    },

    snapshot() {
      return game.debugSnapshot();
    },

    startGame() {
      game.debugStartGame();
    },

    setScore(n) {
      game.debugSetScore(n);
    },

    setLives(n) {
      game.debugSetLives(n);
    },

    setInvuln(seconds) {
      game.debugSetInvuln(seconds);
    },

    setShip(state) {
      game.debugSetShip(state ?? {});
    },

    clearRocks() {
      game.debugClearRocks();
    },

    addRock(size, state) {
      return game.debugAddRock(size, state ?? {});
    },

    addBullet(state) {
      game.debugAddBullet(state ?? {});
    },

    spawnSaucer() {
      game.debugSpawnSaucer();
    },

    setSaucer(state) {
      game.debugSetSaucer(state ?? {});
    },

    removeSaucer() {
      game.debugRemoveSaucer();
    },

    setTorpedoReady(ready) {
      game.debugSetTorpedoReady(Boolean(ready));
    },

    // Inject keyboard input through the very same path the real keyboard feeds
    // (a dispatched KeyboardEvent the Input listener catches), so held movement
    // and edge actions behave exactly as a player's keypress would. Unlike the
    // control operations above, this does NOT take the clock or the ship over —
    // a held movement key flies the ship through the game's own update when
    // stepped — so a caller can confirm the controls themselves work.
    keyDown(code) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code }));
      // Apply any one-shot action (menu move, confirm, pause, mute) at once, so a
      // caller need not wait for a render frame to see it take effect.
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

  (window as unknown as { __shatter?: ShatterDebugApi }).__shatter = api;
}
