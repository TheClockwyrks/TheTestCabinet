// Deepcore — the single-slot expedition save (specs/gameplay.md,
// specs/modes.md).
//
// There is one slot, written only at the surface Save Pad, held in the browser.
// A save is a complete snapshot of the expedition taken while the miner stands
// safely at the camp: the generated mine and its size, the mode, the banked
// Credits, every tier, the installed components, the held supplies, the cargo,
// the satchel, and the fuel and hull. A live Core Sample is never in hand when a
// save is taken, so its timer is never persisted.
//
// The engine holds no persistence, so this is the game's. Storage may be
// unavailable — a private window, a browser that blocks site data, or a
// node-hosted test — in which case every call below reports that plainly and the
// game runs without saving.

import type {
  ComponentId,
  ItemId,
  Mode,
  OreId,
  TrackName,
  WorldSize,
} from "./constants";
import type { Grid, MaterialNode } from "./game";

/** The one key the slot lives under. */
const SAVE_KEY = "deepcore.save.v1";

/** A complete expedition snapshot. */
export interface SaveData {
  version: 1;
  mode: Mode;
  size: WorldSize;
  credits: number;
  creditsEarned: number;
  tiers: Record<TrackName, number>;
  installed: ComponentId[];
  items: Record<ItemId, number>;
  cargo: Record<OreId, number>;
  satchel: { resonite: number; cryenite: number };
  grid: Grid;
  nodes: readonly MaterialNode[];
  deepestDepthMeters: number;
  elapsedSeconds: number;
  fuel: number;
  hull: number;
}

/** The browser's storage, or `null` where it cannot be reached. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Whether a saved expedition exists, which is what puts CONTINUE on the menu. */
export function hasSave(): boolean {
  const slot = storage();
  if (!slot) return false;
  try {
    return slot.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Read the saved expedition, or `null` where there is none or it will not read. */
export function readSave(): SaveData | null {
  const slot = storage();
  if (!slot) return null;
  try {
    const raw = slot.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (!data || data.version !== 1 || !Array.isArray(data.grid)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Overwrite the single slot. `false` where storage is unavailable. */
export function writeSave(data: SaveData): boolean {
  const slot = storage();
  if (!slot) return false;
  try {
    slot.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Delete the slot, which a Hardcore death does and a victory does. */
export function clearSave(): void {
  const slot = storage();
  if (!slot) return;
  try {
    slot.removeItem(SAVE_KEY);
  } catch {
    // Storage went away; there is nothing to delete.
  }
}
