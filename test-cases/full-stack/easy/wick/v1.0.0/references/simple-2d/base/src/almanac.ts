// Wick — what the almanac holds (specs/ui.md "`almanac`").
//
// Four tabs, one list each, and every entry carrying the four parts the
// screen shows: its name, the produced picture it draws, the figures it
// lists, and its one line of copy. Every one of them is read off
// `src/constants.ts` and the weapon tables, so the almanac describes the game
// the rest of this build plays rather than a table written twice. The window
// the list shows is the one rule here that is not a lookup: it follows the
// highlight, and `src/flow.ts` applies it on every move.

import {
  ALMANAC_ROWS,
  BASE_WEAPON_IDS,
  BREAD_HEAL,
  ENEMIES,
  ENEMY_DESCRIPTIONS,
  ENEMY_IDS,
  EVOLUTION_IDS,
  GEM_DESCRIPTIONS,
  GEM_NAMES,
  GEM_TIERS,
  GEM_VALUES,
  PASSIVES,
  PASSIVE_DESCRIPTIONS,
  PASSIVE_IDS,
  PICKUP_DESCRIPTIONS,
  PICKUP_KINDS,
  PICKUP_NAMES,
  WEAPON_DESCRIPTIONS,
  WEAPON_NAMES,
  type EnemyId,
  type GemTier,
  type PassiveId,
  type PickupKind,
  type WeaponId,
} from "./constants";
import { rowFor } from "./sim/weapons";

/** The produced sprite an entry's detail pane draws. */
export type AlmanacPicture =
  | { readonly kind: "weapon"; readonly id: WeaponId }
  | { readonly kind: "passive"; readonly id: PassiveId }
  | { readonly kind: "enemy"; readonly id: EnemyId }
  | { readonly kind: "gem"; readonly id: GemTier }
  | { readonly kind: "pickup"; readonly id: PickupKind };

/** One line of figures: the label the specification fixes, and its figure. */
export interface AlmanacStat {
  readonly label: string;
  readonly value: string;
}

/** One entry of one tab, as the list and the detail pane show it. */
export interface AlmanacEntry {
  readonly name: string;
  readonly picture: AlmanacPicture;
  readonly stats: readonly AlmanacStat[];
  readonly description: string;
}

/** A figure as the pane writes it, clear of the noise of binary fractions. */
function figure(value: number): string {
  return String(Number(value.toFixed(2)));
}

/** A tool: its icon and effect, the damage and cooldown of its first row. */
function weaponEntry(id: WeaponId): AlmanacEntry {
  // An evolved weapon's fixed row is its level `1` row, and Chandelier's
  // carries no cooldown, so it lists its damage alone.
  const row = rowFor(id, 1);
  const stats: AlmanacStat[] = [{ label: "DAMAGE", value: figure(row.damage) }];
  if (row.cooldown !== undefined) {
    stats.push({ label: "COOLDOWN", value: figure(row.cooldown) });
  }
  return {
    name: WEAPON_NAMES[id],
    picture: { kind: "weapon", id },
    stats,
    description: WEAPON_DESCRIPTIONS[id],
  };
}

/** A trinket: its icon and the level past which it is no longer offered. */
function passiveEntry(id: PassiveId): AlmanacEntry {
  return {
    name: PASSIVES[id].name,
    picture: { kind: "passive", id },
    stats: [{ label: "MAX LEVEL", value: figure(PASSIVES[id].maxLevel) }],
    description: PASSIVE_DESCRIPTIONS[id],
  };
}

/** An enemy: its walk sheet and the three figures of its row. */
function enemyEntry(id: EnemyId): AlmanacEntry {
  const def = ENEMIES[id];
  return {
    name: def.name,
    picture: { kind: "enemy", id },
    stats: [
      { label: "HEALTH", value: figure(def.hp) },
      { label: "SPEED", value: figure(def.speed) },
      { label: "DAMAGE", value: figure(def.damage) },
    ],
    description: ENEMY_DESCRIPTIONS[id],
  };
}

/** A gem: its sprite and the experience it is worth. */
function gemEntry(id: GemTier): AlmanacEntry {
  return {
    name: GEM_NAMES[id],
    picture: { kind: "gem", id },
    stats: [{ label: "EXPERIENCE", value: figure(GEM_VALUES[id]) }],
    description: GEM_DESCRIPTIONS[id],
  };
}

/** A pickup: its sprite, and what bread heals; a chest and a draft list none. */
function pickupEntry(id: PickupKind): AlmanacEntry {
  return {
    name: PICKUP_NAMES[id],
    picture: { kind: "pickup", id },
    stats:
      id === "bread" ? [{ label: "HEALS", value: figure(BREAD_HEAL) }] : [],
    description: PICKUP_DESCRIPTIONS[id],
  };
}

/** The entries of every tab, in `ALMANAC_TABS` order. */
export const ALMANAC_ENTRIES: readonly (readonly AlmanacEntry[])[] = [
  [...BASE_WEAPON_IDS, ...EVOLUTION_IDS].map(weaponEntry),
  PASSIVE_IDS.map(passiveEntry),
  ENEMY_IDS.map(enemyEntry),
  [...GEM_TIERS.map(gemEntry), ...PICKUP_KINDS.map(pickupEntry)],
];

/** The entries of the tab at `tab`, an index into `ALMANAC_TABS`. */
export function entriesOf(tab: number): readonly AlmanacEntry[] {
  return ALMANAC_ENTRIES[tab];
}

/** The greatest first row a tab of `count` entries can show. */
export function maxScroll(count: number): number {
  return Math.max(0, count - ALMANAC_ROWS);
}

/** How many rows a list of `count` entries shows from `scroll`. */
export function visibleRows(count: number, scroll: number): number {
  return Math.max(0, Math.min(ALMANAC_ROWS, count - scroll));
}

/** The window a list of `count` entries shows once `index` is highlighted. */
export function scrollToShow(
  scroll: number,
  index: number,
  count: number,
): number {
  const near = Math.min(scroll, index);
  const far = Math.max(near, index - ALMANAC_ROWS + 1);
  return Math.min(Math.max(far, 0), maxScroll(count));
}
