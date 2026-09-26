// Deepcore — the single-slot expedition save (specs/expedition.md, specs/modes.md).
//
// There is one slot, written only at the surface Save Pad, held in the browser. A save
// is a complete snapshot of the expedition taken while the miner stands safely at the
// camp: the generated mine and its size, the mode, the banked Credits, every tier, the
// installed components, the held supplies, the cargo, the satchel, and the fuel and
// hull. A live Core Sample is never in hand when a save is taken, so its timer is never
// persisted. Storage may be unavailable, in which case the game runs without saving.

import type {
  Cargo,
  ItemCounts,
  Mode,
  RocketComponentId,
  Tile,
  UpgradeTiers,
} from "./types";
import type { WorldSize } from "./constants";
import type { MaterialNode } from "./world";

const SAVE_KEY = "deepcore.save.v1";

/** A complete expedition snapshot. */
export interface SaveData {
  version: 1;
  mode: Mode;
  size: WorldSize;
  credits: number;
  creditsEarned: number;
  tiers: UpgradeTiers;
  installed: RocketComponentId[];
  items: ItemCounts;
  cargo: Cargo;
  satchel: { resonite: number; cryenite: number };
  grid: Tile[][];
  nodes: MaterialNode[];
  deepestDepthMeters: number;
  elapsedSeconds: number;
  fuel: number;
  hull: number;
}

/** The browser's storage, or null where it cannot be reached. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Whether a saved expedition exists, which is what puts CONTINUE on the main menu. */
export function hasSave(): boolean {
  const s = storage();
  if (!s) return false;
  try {
    return s.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Read the saved expedition, or null where there is none or it cannot be read. */
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

/** Overwrite the single slot. False where storage is unavailable. */
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

/** Delete the slot, which a Hardcore death does and a victory does. */
export function clearSave(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(SAVE_KEY);
  } catch {
    // Storage went away; there is nothing to delete.
  }
}
