// Spectra — the debugging and automation API installed on window.__spectra.
//
// A thin surface over the exact game the UI drives: it advances the real
// fixed-timestep simulation (game.fixedStep) and reads the real state
// (game.debugSnapshot), so a scenario driven from code behaves identically to one
// played by hand. It only sets up situations and steps the real systems forward;
// it never fabricates an outcome. See specs/instrumentation.md.

import { FIXED_STEP } from "./constants";
import type { BandStr } from "./constants";
import type {
  Game,
  SpawnBulletSpec,
  SpawnDroneSpec,
  SpectraSnapshot,
} from "./game";

export interface SpectraDebugApi {
  version: number;
  reset(options?: { seed?: number }): void;
  step(seconds: number): void;
  snapshot(): SpectraSnapshot;
  setAutoStep(enabled: boolean): void;
  startGame(): void;
  startStage(stage: number): void;
  setShipX(x: number): void;
  setShipBand(band: BandStr): void;
  flip(): void;
  discharge(): void;
  setResonance(value: number): void;
  setLives(n: number): void;
  setScore(n: number): void;
  spawnDrone(spec: SpawnDroneSpec): number;
  forceDive(id: number): void;
  spawnPlayerBullet(spec: SpawnBulletSpec): void;
  spawnEnemyBullet(spec: SpawnBulletSpec): void;
  clearField(): void;
  keyDown(code: string): void;
  keyUp(code: string): void;
  press(code: string): void;
}

export function installDebugApi(game: Game): void {
  const api: SpectraDebugApi = {
    version: 1,

    reset(options) {
      game.debugReset(options?.seed);
    },

    // Advance the real simulation by `seconds`, in whole fixed steps, without
    // waiting on real time, and switch to manual stepping.
    step(seconds) {
      game.setAutoStep(false);
      const steps = Math.max(0, Math.round(seconds / FIXED_STEP));
      for (let i = 0; i < steps; i++) {
        game.fixedStep(FIXED_STEP);
        game.updateVisual(FIXED_STEP);
      }
    },

    snapshot() {
      return game.debugSnapshot();
    },

    setAutoStep(enabled) {
      game.setAutoStep(Boolean(enabled));
    },

    startGame() {
      game.debugStartGame();
    },

    startStage(stage) {
      game.debugStartStage(stage);
    },

    setShipX(x) {
      game.debugSetShipX(x);
    },

    setShipBand(band) {
      game.debugSetShipBand(band);
    },

    flip() {
      game.debugFlip();
    },

    discharge() {
      game.debugDischarge();
    },

    setResonance(value) {
      game.debugSetResonance(value);
    },

    setLives(n) {
      game.debugSetLives(n);
    },

    setScore(n) {
      game.debugSetScore(n);
    },

    spawnDrone(spec) {
      return game.debugSpawnDrone(spec);
    },

    forceDive(id) {
      game.debugForceDive(id);
    },

    spawnPlayerBullet(spec) {
      game.debugSpawnPlayerBullet(spec);
    },

    spawnEnemyBullet(spec) {
      game.debugSpawnEnemyBullet(spec);
    },

    clearField() {
      game.debugClearField();
    },

    // Inject keyboard input through the very same path the real keyboard feeds
    // (a dispatched KeyboardEvent the Input listener catches), so held movement
    // and edge actions behave exactly as a player's keypress would. This does NOT
    // change the step clock (specs/instrumentation.md).
    keyDown(code) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code }));
      // Apply any one-shot action (menu move, confirm, flip, discharge, pause,
      // mute) at once, so a caller need not wait for a render frame.
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

  (window as unknown as { __spectra?: SpectraDebugApi }).__spectra = api;
}
