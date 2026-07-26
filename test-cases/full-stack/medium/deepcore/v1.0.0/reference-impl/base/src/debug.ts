// Deepcore — the debugging and automation API installed on window.__deepcore
// (specs/instrumentation.md).
//
// A thin surface over the exact game the UI drives: it advances the real fixed-timestep
// simulation (game.fixedStep) and reads the real state (game.debugSnapshot / debugTileAt /
// debugFindTile), so a scenario driven from code behaves identically to one played by hand.
// The control operations only ARRANGE a situation — routing through the same systems normal
// play uses — and then let the real simulation produce the outcome, which a caller reads back
// from snapshot()/tileAt()/rendered pixels; they never fabricate an outcome. The input
// operations inject real keyboard events through the very path the physical keyboard feeds.
//
// The manual-step clock (game.autoStep) is what makes a scripted scenario exact and flake-free:
// reset()/step() switch the sim to driver-clocked (autoStep = false), so no stray wall-clock
// frame can pollute a measurement; setAutoStep(true) hands the clock back for a live motion clip.

import { TICK_DT } from "./constants";
import type { WorldSize } from "./constants";
import { buyFuel, buyRepair, buyUpgrade, dropOre, sellCargo } from "./economy";
import { buyItem, useItem } from "./items";
import { fabricate } from "./rocket";
import type { DeepcoreSnapshot, Game, TileRead } from "./game";
import type { ItemId, Mode, Ore, TileKind, UpgradeTiers, UpgradeTrack } from "./types";
import type { Audio } from "./audio";
import type { Input } from "./input";

/** The panels the debug API can open directly (the inventory has its own op). */
type SurfacePanel = "fuel-depot" | "ore-market" | "upgrade-shop" | "supply-depot" | "launch-pad";

export interface DeepcoreDebugApi {
  version: number;
  // Core
  reset(options?: { seed?: number }): void;
  /** Advance the sim by exactly `ticks` fixed 60 Hz steps. Non-negative integers only. */
  step(ticks: number): void;
  snapshot(): DeepcoreSnapshot;
  tileAt(col: number, row: number): TileRead | null;
  findTile(kind: TileKind): { col: number; row: number } | null;
  /** The surface buildings and each one's footprint in world logical pixels (specs/world.md). */
  buildings(): { id: string; x: number; y: number; w: number; h: number }[];
  // Control — arrange a situation, routing through the real systems
  startExpedition(mode: Mode, size?: WorldSize): void;
  teleport(col: number, row: number): void;
  setFuel(value: number): void;
  setHull(value: number): void;
  grantCredits(amount: number): void;
  grantGear(tiers: number | Partial<UpgradeTiers>): void;
  addCargo(ore: Ore, count: number): void;
  dropOre(ore: Ore): void;
  giveMaterial(kind: "resonite" | "cryenite"): void;
  spawnCoreSample(): void;
  setTile(col: number, row: number, spec: { kind: TileKind; ore?: Ore; material?: "resonite" | "cryenite" }): void;
  sell(): void;
  buyUpgrade(track: UpgradeTrack): void;
  buyFuel(units: number): void;
  buyRepair(points: number): void;
  buyItem(id: ItemId): void;
  useItem(id: ItemId): void;
  fabricate(): void;
  launch(): void;
  openPanel(panel: SurfacePanel): void;
  openInventory(): void;
  closePanel(): void;
  save(): void;
  setMuted(muted: boolean): void;
  setAutoStep(enabled: boolean): void;
  jettison(): void;
  // Input — inject real keyboard events
  keyDown(code: string): void;
  keyUp(code: string): void;
  press(code: string): void;
}

/**
 * Map a standard `KeyboardEvent.code` to the `key` the Input listener reads (it matches on
 * `e.key`, lowercased for held movement). Covers every code the spec lists; anything else falls
 * through unchanged.
 */
const CODE_TO_KEY: Record<string, string> = {
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  KeyW: "w",
  KeyA: "a",
  KeyS: "s",
  KeyD: "d",
  Space: " ",
  KeyE: "e",
  KeyM: "m",
  KeyI: "i",
  KeyJ: "j",
  Enter: "Enter",
  Escape: "Escape",
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
  Digit5: "5",
  Digit6: "6",
  Backquote: "`",
};

function keyForCode(code: string): string {
  return CODE_TO_KEY[code] ?? code;
}

export interface DebugContext {
  game: Game;
  input: Input;
  audio: Audio;
  /** Process any queued edge input (menu nav, activate, pause, mute, hotkeys) immediately, the
   *  same routing the animation-frame loop runs each frame (main.ts). */
  drainEdges: () => void;
}

export function installDebugApi(ctx: DebugContext): void {
  const { game, input, drainEdges } = ctx;

  const api: DeepcoreDebugApi = {
    version: 1,

    // ---- Core ----
    reset(options) {
      game.debugReset(options?.seed);
    },

    // Advance the real simulation by exactly `ticks` fixed steps, without waiting on real time.
    // The unit is whole simulation ticks (60 Hz, so one tick is TICK_DT seconds), so nothing is
    // rounded: the number of steps asked for is the number of steps run. A fractional or negative
    // count is rejected rather than guessed at. Feeds the injected held-key set into each step so
    // a held movement/thrust/drill key drives the miner through the game's own update
    // (specs/instrumentation.md).
    step(ticks) {
      if (!Number.isInteger(ticks) || ticks < 0) {
        throw new Error(`__deepcore.step(ticks): expected a non-negative integer tick count, got ${ticks}`);
      }
      game.autoStep = false;
      for (let i = 0; i < ticks; i++) {
        game.input = input.held();
        game.fixedStep(TICK_DT);
      }
    },

    snapshot() {
      return game.debugSnapshot();
    },

    tileAt(col, row) {
      return game.debugTileAt(col, row);
    },

    findTile(kind) {
      return game.debugFindTile(kind);
    },

    buildings() {
      return game.debugBuildings();
    },

    // ---- Control ----
    startExpedition(mode, size) {
      game.startExpedition(mode, size);
    },

    teleport(col, row) {
      game.teleport(col, row);
    },

    setFuel(value) {
      game.setFuel(value);
    },

    setHull(value) {
      game.setHull(value);
    },

    grantCredits(amount) {
      game.grantCredits(amount);
    },

    grantGear(tiers) {
      game.grantGear(tiers);
    },

    addCargo(ore, count) {
      game.addCargo(ore, count);
    },

    dropOre(ore) {
      dropOre(game, ore);
    },

    giveMaterial(kind) {
      game.giveMaterial(kind);
    },

    spawnCoreSample() {
      game.spawnCoreSample();
    },

    setTile(col, row, spec) {
      game.setTile(col, row, spec);
    },

    sell() {
      sellCargo(game);
    },

    buyUpgrade(track) {
      buyUpgrade(game, track);
    },

    buyFuel(units) {
      buyFuel(game, units);
    },

    buyRepair(points) {
      buyRepair(game, points);
    },

    buyItem(id) {
      buyItem(game, id);
    },

    useItem(id) {
      useItem(game, id);
    },

    fabricate() {
      fabricate(game);
    },

    launch() {
      game.startLaunch();
    },

    openPanel(panel) {
      game.openPanel(panel);
    },

    openInventory() {
      game.openInventory();
    },

    closePanel() {
      game.closePanel();
    },

    save() {
      game.trySave();
    },

    setMuted(muted) {
      game.setMuted(muted);
    },

    // Hand the clock back to (or take it from) normal wall-clock running. Does NOT reset the
    // scenario — setAutoStep(true) is what you call before a live api.wait(...) motion clip.
    setAutoStep(enabled) {
      game.autoStep = Boolean(enabled);
    },

    jettison() {
      game.jettisonCoreSample();
    },

    // ---- Input ----
    // Inject keyboard input through the very same path the real keyboard feeds (a dispatched
    // KeyboardEvent the Input listener catches), so held movement and edge actions behave exactly
    // as a player's keypress would. Unlike the control operations, this does NOT switch the clock
    // — a held movement key drives the miner through the game's own update while the sim is
    // stepped — which is how a caller confirms the controls themselves work.
    keyDown(code) {
      const key = keyForCode(code);
      window.dispatchEvent(new KeyboardEvent("keydown", { key, code }));
      // Apply any one-shot action (menu move, confirm, activate, pause, inventory, mute, hotkey,
      // jettison, overlay) at once, so a caller need not wait for a render frame to see it.
      drainEdges();
    },

    keyUp(code) {
      const key = keyForCode(code);
      window.dispatchEvent(new KeyboardEvent("keyup", { key, code }));
    },

    press(code) {
      this.keyDown(code);
      this.keyUp(code);
    },
  };

  (window as unknown as { __deepcore?: DeepcoreDebugApi }).__deepcore = api;
}
