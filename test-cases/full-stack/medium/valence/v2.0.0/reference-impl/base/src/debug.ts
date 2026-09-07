// Valence — the debugging and automation API installed on window.__valence.
//
// A thin surface over the exact game the UI drives: it advances the real fixed-timestep
// simulation (game.fixedStep) and reads the real state (game.debugSnapshot), so a scenario
// driven from code behaves identically to one played by hand. It only sets up situations and
// steps the real systems forward; it never fabricates an outcome. See specs/instrumentation.md.

import {
  FIXED_STEP,
  type Branch,
  type TargetingMode,
  type TowerKind,
} from "./constants";
import { MAPS } from "./board";
import type { Game, ValenceSnapshot } from "./sim";

// A caller uses standard KeyboardEvent.code values (specs/instrumentation.md); the game's
// input layer reads KeyboardEvent.key, so a dispatched event carries both. Codes not listed
// fall back to a single lowercased character, covering the letter/digit keys directly.
const KEY_FOR_CODE: Record<string, string> = {
  Space: " ",
  Escape: "Escape",
  Enter: "Enter",
  Backquote: "`",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
};
function keyForCode(code: string): string {
  if (KEY_FOR_CODE[code]) return KEY_FOR_CODE[code]!;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code;
}

export interface SpawnSpec {
  type?: string;
  electrons?: number;
  inert?: boolean; // release it shielded, whichever traits the type already carries
  pathId?: number;
  progress?: number;
}

export interface ValenceDebugApi {
  version: number;
  reset(options?: { seed?: number }): void;
  /** Advance the simulation by exactly `ticks` fixed steps. `ticks` must be a non-negative integer. */
  step(ticks: number): void;
  snapshot(): ValenceSnapshot;
  /**
   * Bring every value this surface reports into agreement with the board as it now
   * stands, without advancing the simulation by any amount.
   */
  reconcile(): void;
  setAutoStep(enabled: boolean): void;
  selectMap(mapId: string): void;
  goToMapSelect(): void;
  setEnergy(amount: number): void;
  setIntegrity(amount: number): void;
  setRound(n: number): void;
  startRound(): void;
  /** Open a live round with no wave that does not end on its own — the scenario board. */
  startScenario(): boolean;
  spawnUnit(spec?: SpawnSpec): number;
  placeTower(
    type: TowerKind,
    x: number,
    y: number,
  ): { ok: boolean; id: number | null; reason: string | null };
  upgradeTower(id: number, branch?: Branch): boolean;
  sellTower(id: number): number;
  selectTower(id: number | null): void;
  setTargeting(id: number, priority: TargetingMode): void;
  setInertPriority(id: number, on: boolean): void;
  setSpeed(multiplier: number): void;
  keyDown(code: string): void;
  keyUp(code: string): void;
  press(code: string): void;
}

// `processInput` is the loop's once-per-frame input drain (main.ts), so an injected key's
// one-shot action takes effect at once without waiting for a render frame.
export function installDebugApi(game: Game, processInput: () => void): void {
  const api: ValenceDebugApi = {
    version: 1,

    // Return to the title state; `options.seed` seeds all randomness. Re-arms manual stepping.
    reset(options) {
      game.debugReset(options?.seed);
    },

    // Advance the real simulation by exactly `ticks` fixed steps, without waiting on real
    // time. The unit is whole ticks, not seconds (specs/instrumentation.md): the timestep is
    // 60 Hz, so step(60) is one second of game time. Nothing is rounded — a fractional or
    // negative count is a caller bug, not something to guess at, so it fails loudly rather
    // than silently running a different number of steps than was asked for.
    // Takes the clock (manual stepping) for the rest of the driven session.
    step(ticks) {
      if (!Number.isInteger(ticks) || ticks < 0) {
        throw new Error(
          `step(ticks) expects a non-negative integer tick count, got ${ticks}`,
        );
      }
      game.autoStep = false;
      for (let i = 0; i < ticks; i++) game.fixedStep(FIXED_STEP);
    },

    snapshot() {
      return game.debugSnapshot();
    },

    // Re-derive every reading that is a function of the board — a unit's position, the
    // detectors and auras reaching it, a tower's stats and what it is aiming at — from the
    // board exactly as it now stands (specs/instrumentation.md, "Reconciling derived
    // state"). It moves no clock and fires nothing, so a caller poses a situation,
    // reconciles it, and reads back a description of the situation it posed rather than of
    // the one before it. `step()` is not a substitute: a step would move the very thing
    // the pose just placed.
    reconcile() {
      game.reconcile();
    },

    setAutoStep(enabled) {
      game.autoStep = Boolean(enabled);
    },

    // The map ids are an enumerated domain (specs/instrumentation.md), so an id naming
    // none of them fails loudly rather than starting a run on a map nobody asked for — a
    // silent fallback would have every later reading answer for the wrong board. The
    // screen the game is on is not consulted: this is a control operation, and a
    // player's route to the map select is not a condition on it.
    selectMap(mapId) {
      const map = MAPS.find((m) => m.id === mapId);
      if (map === undefined) {
        throw new Error(
          `selectMap: no map carries the id ${String(mapId)}; the ids are ` +
            MAPS.map((m) => m.id).join(", "),
        );
      }
      game.startOn(map);
    },

    goToMapSelect() {
      game.state = "mapselect";
    },

    setEnergy(amount) {
      game.debugSetEnergy(amount);
    },

    setIntegrity(amount) {
      game.debugSetIntegrity(amount);
    },

    setRound(n) {
      game.debugSetRound(n);
    },

    // The round-start TRANSACTION, not the player's route to the START ROUND control:
    // `performStartRound` launches the round from wherever the game stands, where
    // `game.startRound()` is the on-screen control and keeps the phase check that decides
    // whether a player could have pressed it (specs/instrumentation.md, "Control
    // operations").
    startRound() {
      game.performStartRound();
    },

    startScenario() {
      return game.startScenario();
    },

    spawnUnit(spec) {
      return game.debugSpawnUnit(spec ?? {});
    },

    placeTower(type, x, y) {
      return game.debugPlaceTower(type, x, y);
    },

    upgradeTower(id, branch) {
      return game.debugUpgradeTower(id, branch);
    },

    sellTower(id) {
      return game.debugSellTower(id);
    },

    selectTower(id) {
      game.debugSelectTower(id);
    },

    setTargeting(id, priority) {
      game.debugSetTargeting(id, priority);
    },

    setInertPriority(id, on) {
      game.debugSetInertPriority(id, on);
    },

    setSpeed(multiplier) {
      game.debugSetSpeed(multiplier);
    },

    // Inject keyboard input through the very same path the real keyboard feeds (a dispatched
    // KeyboardEvent the Input listener catches), then drain it at once so the one-shot action
    // (a menu move, a confirm, a pause, a mute, a speed cycle, a tower/inspector hotkey) takes
    // effect immediately. This does not change autoStep.
    keyDown(code) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { code, key: keyForCode(code) }),
      );
      processInput();
    },

    keyUp(code) {
      window.dispatchEvent(
        new KeyboardEvent("keyup", { code, key: keyForCode(code) }),
      );
    },

    press(code) {
      this.keyDown(code);
      this.keyUp(code);
    },
  };

  (window as unknown as { __valence?: ValenceDebugApi }).__valence = api;
}
