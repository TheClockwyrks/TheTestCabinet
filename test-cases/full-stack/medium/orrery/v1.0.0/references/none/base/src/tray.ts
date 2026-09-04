// Orrery — the tray (specs/editor.md "The tray").
//
// The tray offers what the challenge permits, and its order is DERIVED rather
// than authored: the challenge's `permitted` kinds sorted into `PARTS` order
// whatever order the document listed them in, then one `rise` per reagent in
// reagent order, then one `set` per product in product order. So a challenge
// never fixes the tray's layout; the roster of specs/parts.md does.
//
// The rectangles are the press targets. A press inside entry `k`'s rectangle
// begins placing that entry's part, and a press in the tray outside every one
// of them does nothing beyond setting the focus, so this module answers exactly
// two questions: what the entries are, and which one a point lands in.
//
// A rise or set entry is SPENT while its part is on the field — pressing it
// begins nothing until the placed part is deleted — and every other entry
// places any number of copies.

import {
  PARTS,
  PART_COSTS,
  TRAY_SLOT_H,
  TRAY_W,
  TRAY_X0,
  TRAY_Y0,
} from "./constants";
import { type Rect } from "./regions";
import type { Challenge, PartKind, PartState } from "./types";

/** One tray entry: a part the challenge offers, and what it costs to place. */
export interface TrayEntry {
  /** The part kind a press on this entry begins placing. */
  readonly kind: PartKind;
  /** Which reagent or product, for a `rise` or a `set`; `null` otherwise. */
  readonly index: number | null;
  /** The name the entry shows. */
  readonly label: string;
  /** The entry's cost from `PART_COSTS`. */
  readonly cost: number;
  /** Whether that cost is charged per cell, which a `track` alone is. */
  readonly perCell: boolean;
}

/**
 * The challenge's tray, in order: the permitted kinds in `PARTS` order, then
 * one rise per reagent, then one set per product. An unopened challenge offers
 * nothing.
 */
export function trayEntries(challenge: Challenge | null): TrayEntry[] {
  if (challenge === null) return [];
  const entries: TrayEntry[] = [];
  for (const kind of PARTS) {
    if (!challenge.permitted.includes(kind)) continue;
    entries.push({
      kind,
      index: null,
      label: kind,
      cost: PART_COSTS[kind],
      perCell: kind === "track",
    });
  }
  challenge.reagents.forEach((_molecule, index) => {
    entries.push({
      kind: "rise",
      index,
      label: `rise ${index + 1}`,
      cost: PART_COSTS.rise,
      perCell: false,
    });
  });
  challenge.products.forEach((_molecule, index) => {
    entries.push({
      kind: "set",
      index,
      label: `set ${index + 1}`,
      cost: PART_COSTS.set,
      perCell: false,
    });
  });
  return entries;
}

/** Entry `k`'s rectangle, counted from `0` at the tray's top. */
export function traySlotRect(k: number): Rect {
  return {
    x0: TRAY_X0,
    y0: TRAY_Y0 + k * TRAY_SLOT_H,
    x1: TRAY_X0 + TRAY_W,
    y1: TRAY_Y0 + (k + 1) * TRAY_SLOT_H,
  };
}

/**
 * Which of `count` entries a stage position lands in, and `null` when it lands
 * in none of them.
 */
export function trayEntryIndexAt(
  x: number,
  y: number,
  count: number,
): number | null {
  if (x < TRAY_X0 || x >= TRAY_X0 + TRAY_W) return null;
  if (y < TRAY_Y0) return null;
  const k = Math.floor((y - TRAY_Y0) / TRAY_SLOT_H);
  return k >= 0 && k < count ? k : null;
}

/**
 * Whether an entry is spent: a rise or a set whose part stands on the field.
 * Every other entry places any number of copies and is never spent.
 */
export function entrySpent(
  entry: TrayEntry,
  parts: readonly PartState[],
): boolean {
  if (entry.kind !== "rise" && entry.kind !== "set") return false;
  return parts.some(
    (part) => part.kind === entry.kind && part.index === entry.index,
  );
}
