// Fathom — the debugging and automation API installed on window.__fathom.
//
// A thin surface over the exact game the UI drives: it advances the real
// fixed-timestep simulation (game.fixedStep) and reads the real state
// (game.debugSnapshot), so a scenario driven from code behaves identically to one
// played by hand. Control ops only arrange a situation and step the real systems
// forward; they never fabricate an outcome. See specs/instrumentation.md.

import { FIXED_STEP } from "./constants";
import type { FathomSnapshot, Game } from "./game";

interface ForagerPose {
  tx?: number;
  ty?: number;
  dir?: string;
}

interface PredatorPose {
  tx?: number;
  ty?: number;
  dir?: string;
  mode?: string;
}

export interface FathomDebugApi {
  version: number;
  reset(options?: { seed?: number }): void;
  /** Advance the simulation by exactly this many whole fixed steps (ticks). */
  step(ticks: number): void;
  setAutoStep(enabled: boolean): void;
  snapshot(): FathomSnapshot;
  startDive(): void;
  beginPlay(): void;
  setDepth(d: number): void;
  setForager(state: ForagerPose): void;
  setBrightness(g: number): void;
  setPredator(kind: string, state: PredatorPose): void;
  spawnDrifter(state?: { tx?: number; ty?: number }): void;
  poseLastPlankton(): void;
  clearCooldowns(): void;
  keyDown(code: string): void;
  keyUp(code: string): void;
  press(code: string): void;
}

export function installDebugApi(game: Game): void {
  const api: FathomDebugApi = {
    version: 1,

    reset(options) {
      game.debugReset(options?.seed);
    },

    // Advance the real simulation by exactly `ticks` fixed steps, without waiting on
    // real time. The unit is whole simulation ticks, not seconds: the game runs a
    // fixed 120 Hz timestep (FIXED_STEP), so one tick is 1/120 s and step(120) is a
    // second of game time. Ticks are the honest unit for a fixed-timestep sim — a
    // seconds argument has to be rounded to a whole number of steps, which silently
    // moves the sim a different distance than the caller asked for and means
    // something different at every simulation rate. So there is no rounding here, and
    // a fractional or negative count is a caller mistake to surface rather than to
    // guess at.
    //
    // Turns off automatic stepping so a stepped scenario is exact and reproducible
    // (specs/instrumentation.md#the-manual-clock).
    step(ticks) {
      if (!Number.isInteger(ticks) || ticks < 0) {
        throw new Error(
          `__fathom.step(ticks): expected a non-negative whole number of simulation ticks (1 tick = 1/120 s), received ${String(ticks)}`,
        );
      }
      game.debugSetAutoStep(false);
      for (let i = 0; i < ticks; i++) game.fixedStep(FIXED_STEP);
    },

    setAutoStep(enabled) {
      game.debugSetAutoStep(Boolean(enabled));
    },

    snapshot() {
      return game.debugSnapshot();
    },

    startDive() {
      game.debugStartDive();
    },

    beginPlay() {
      game.debugBeginPlay();
    },

    setDepth(d) {
      game.debugSetDepth(d);
    },

    setForager(state) {
      game.debugSetForager(state ?? {});
    },

    setBrightness(g) {
      game.debugSetBrightness(g);
    },

    setPredator(kind, state) {
      game.debugSetPredator(kind, state ?? {});
    },

    spawnDrifter(state) {
      game.debugSpawnDrifter(state);
    },

    poseLastPlankton() {
      game.debugPoseLastPlankton();
    },

    clearCooldowns() {
      game.debugClearCooldowns();
    },

    // Inject keyboard input through the very same path the real keyboard feeds (a
    // dispatched KeyboardEvent the Input listener catches), so held movement and
    // one-shot actions behave exactly as a player's keypress would. Unlike the
    // control ops above, this does NOT change the manual clock — a held movement
    // key moves the forager through the game's own update — so a caller can confirm
    // the controls themselves work.
    keyDown(code) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code }));
      // Apply any one-shot action (menu move, confirm, pause, mute, sonar, ink) at
      // once, so a caller need not wait for a render frame to see it take effect.
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

  (window as unknown as { __fathom?: FathomDebugApi }).__fathom = api;
}
