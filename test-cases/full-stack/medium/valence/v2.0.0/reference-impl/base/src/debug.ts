// Valence — the debugging and automation API installed on window.__valence.
//
// A thin surface over the exact game the UI drives: it advances the real fixed-timestep
// simulation (game.fixedStep) and reads the real state (game.debugSnapshot), so a scenario
// driven from code behaves identically to one played by hand. It only sets up situations and
// steps the real systems forward; it never fabricates an outcome. See specs/instrumentation.md.

import { FIXED_STEP, type Branch, type TargetingMode, type TowerKind } from "./constants";
import { mapById } from "./board";
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
  setAutoStep(enabled: boolean): void;
  selectMap(mapId: string): void;
  goToMapSelect(): void;
  setEnergy(amount: number): void;
  setIntegrity(amount: number): void;
  setRound(n: number): void;
  startRound(): void;
  spawnUnit(spec?: SpawnSpec): number;
  placeTower(type: TowerKind, x: number, y: number): { ok: boolean; id: number | null; reason: string | null };
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
        throw new Error(`step(ticks) expects a non-negative integer tick count, got ${ticks}`);
      }
      game.autoStep = false;
      for (let i = 0; i < ticks; i++) game.fixedStep(FIXED_STEP);
    },

    snapshot() {
      return game.debugSnapshot();
    },

    setAutoStep(enabled) {
      game.autoStep = Boolean(enabled);
    },

    selectMap(mapId) {
      game.startOn(mapById(mapId));
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

    startRound() {
      game.startRound();
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
      window.dispatchEvent(new KeyboardEvent("keydown", { code, key: keyForCode(code) }));
      processInput();
    },

    keyUp(code) {
      window.dispatchEvent(new KeyboardEvent("keyup", { code, key: keyForCode(code) }));
    },

    press(code) {
      this.keyDown(code);
      this.keyUp(code);
    },
  };

  (window as unknown as { __valence?: ValenceDebugApi }).__valence = api;
}
