// Wireworm — the debugging and automation API installed on window.__wireworm.
//
// A thin surface over the exact game the UI drives: it advances the real
// fixed-timestep simulation (game.fixedStep) and reads the real state
// (game.debugSnapshot), so a scenario driven from code behaves identically to one
// played by hand. It only sets up situations and steps the real systems forward; it
// never fabricates an outcome. See specs/instrumentation.md.

import { FIXED_STEP } from "./constants";
import type { Game, WirewormSnapshot } from "./game";
import type { Foe } from "./types";

interface WormSpec {
  segments: { c: number; r: number }[];
  dh?: number;
  dv?: number;
}

interface FoeOptions {
  x?: number;
  y?: number;
  vx?: number;
  row?: number;
}

export interface WirewormDebugApi {
  version: number;
  // Core
  reset(options?: { seed?: number }): void;
  /** Advance the simulation by exactly this many whole fixed steps (ticks). */
  step(ticks: number): void;
  snapshot(): WirewormSnapshot;
  setAutoStep(enabled: boolean): void;
  // Control
  enterPlay(): void;
  startRun(): void;
  setLevel(n: number): void;
  setScore(n: number): void;
  setLives(n: number): void;
  setCursor(x: number, y: number): void;
  setNode(c: number, r: number, charge: number): void;
  clearField(): void;
  setWorm(spec: WormSpec): void;
  spawnFoe(kind: Foe["kind"], options?: FoeOptions): void;
  fire(): void;
  // Input
  keyDown(code: string): void;
  keyUp(code: string): void;
  press(code: string): void;
}

// A standard KeyboardEvent.code -> KeyboardEvent.key mapping, so injected input
// carries the same `key` value the real keyboard would (the Input listener reads
// e.key). This routes injected input through the very same handling a player's
// keypress feeds, rather than a parallel path.
const KEY_FOR_CODE: Record<string, string> = {
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  KeyA: "a",
  KeyD: "d",
  KeyW: "w",
  KeyS: "s",
  KeyP: "p",
  KeyM: "m",
  Space: " ",
  Enter: "Enter",
  Escape: "Escape",
  Backquote: "`",
};

export function installDebugApi(game: Game): void {
  const api: WirewormDebugApi = {
    version: 1,

    // Return to the initial title state and reseed all randomness; switches to
    // manual mode (the animation-frame loop no longer advances the sim on its own).
    reset(options) {
      game.autoStep = false;
      game.debugReset(options?.seed);
    },

    // Advance the real simulation by exactly `ticks` fixed steps, without waiting
    // on real frames. The unit is whole simulation ticks: at the 120 Hz timestep
    // one tick is 1/120 s, so step(120) is a second of game time. Ticks are the
    // honest unit for a fixed-timestep sim — a seconds argument has to be rounded
    // to a whole number of steps, which silently moves the sim a different distance
    // than the caller asked for and means something different at every simulation
    // rate. So there is no rounding here, and a fractional or negative count is a
    // caller mistake to surface rather than to guess at.
    //
    // Stepping also switches the game to manual mode, so the animation-frame loop
    // no longer advances the sim on its own and these are the exact steps that
    // pass — no stray wall-clock frames.
    step(ticks) {
      if (!Number.isInteger(ticks) || ticks < 0) {
        throw new Error(
          `__wireworm.step(ticks): expected a non-negative whole number of simulation ticks (1 tick = 1/120 s), received ${String(ticks)}`,
        );
      }
      game.autoStep = false;
      for (let i = 0; i < ticks; i++) game.fixedStep(FIXED_STEP);
    },

    snapshot() {
      return game.debugSnapshot();
    },

    // The manual clock: true lets the game run itself in real time (for watching or
    // recording a motion clip), false returns to manual stepping.
    setAutoStep(enabled) {
      game.autoStep = Boolean(enabled);
    },

    enterPlay() {
      game.debugEnterPlay();
    },

    startRun() {
      game.debugStartRun();
    },

    setLevel(n) {
      game.debugSetLevel(n);
    },

    setScore(n) {
      game.debugSetScore(n);
    },

    setLives(n) {
      game.debugSetLives(n);
    },

    setCursor(x, y) {
      game.debugSetCursor(x, y);
    },

    setNode(c, r, charge) {
      game.debugSetNode(c, r, charge);
    },

    clearField() {
      game.debugClearField();
    },

    setWorm(spec) {
      game.debugSetWorm(spec ?? { segments: [] });
    },

    spawnFoe(kind, options) {
      game.debugSpawnFoe(kind, options ?? {});
    },

    fire() {
      game.debugFire();
    },

    // Inject keyboard input through the same window listener the real keyboard
    // feeds (a dispatched KeyboardEvent). The key becomes held, so a movement key
    // drives the cursor and a held fire key fires while the sim is stepped. Unlike
    // the control operations, this does NOT switch the manual clock. A one-shot menu
    // action is applied at once by draining the edge queue, so a caller need not
    // wait for a render frame to see it take effect.
    keyDown(code) {
      const key = KEY_FOR_CODE[code] ?? code;
      window.dispatchEvent(new KeyboardEvent("keydown", { key, code }));
      game.handleInput();
    },

    keyUp(code) {
      const key = KEY_FOR_CODE[code] ?? code;
      window.dispatchEvent(new KeyboardEvent("keyup", { key, code }));
    },

    press(code) {
      this.keyDown(code);
      this.keyUp(code);
    },
  };

  (window as unknown as { __wireworm?: WirewormDebugApi }).__wireworm = api;
}
