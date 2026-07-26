// Deepcore — the single-slot expedition save (specs/gameplay.md, specs/modes.md).
//
// The player has AT MOST ONE save at a time, written only at the surface Save Pad and
// stored in the browser's localStorage. A save is a full snapshot of the expedition taken
// while standing safely at the camp — enough to resume exactly: the generated mine, the
// Credits/tiers/rocket progress, the cargo and materials, and the miner's fuel/hull. The
// Core Sample is never in hand when a save is taken (the pad refuses it, game.ts), so the
// unstable timer is never persisted. localStorage may be unavailable (a locked-down
// context); every access is guarded so the game still runs, only without saving.

import type { Cargo, ItemCounts, Mode, RocketComponentId, Tile, UpgradeTiers } from "./types";
import type { WorldSize } from "./constants";
import type { MaterialNode } from "./world";

const SAVE_KEY = "deepcore.save.v1";

/** A complete expedition snapshot (see module comment). */
export interface SaveData {
  version: 1;
  mode: Mode;
  /** The world SIZE the expedition was dug at (specs/world.md). Optional so pre-size saves,
   *  which predate the option, load as the Standard mine. */
  size?: WorldSize;
  credits: number;
  creditsEarned: number;
  tiers: UpgradeTiers;
  installed: RocketComponentId[];
  /** Held single-use field-supply item counts (specs/items.md). Optional for old saves. */
  items?: ItemCounts;
  cargo: Cargo;
  satchel: { resonite: number; cryenite: number };
  grid: Tile[][];
  nodes: MaterialNode[];
  spawnCol: number;
  deepestRow: number;
  elapsedSeconds: number;
  fuel: number;
  hull: number;
}

/** localStorage if reachable, else null (a sandboxed context disables saving entirely). */
function storage(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Whether a saved expedition currently exists (drives the menu CONTINUE option). */
export function hasSave(): boolean {
  const s = storage();
  if (!s) return false;
  try {
    return s.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Read and validate the saved expedition, or null if none / unreadable. */
export function readSave(): SaveData | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (!data || data.version !== 1 || !Array.isArray(data.grid)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Write (overwrite) the single save slot. Returns false if storage is unavailable. */
export function writeSave(data: SaveData): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Delete the save slot (a Hardcore death or a victory consumes the save). */
export function clearSave(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}
