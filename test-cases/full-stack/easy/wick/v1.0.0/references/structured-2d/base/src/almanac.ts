// Wick — what the almanac holds (specs/ui.md "`almanac`").
//
// The four tabs and their entries, and, for one entry, the four parts the
// screen shows: its name, the produced picture it draws, the stat lines it
// lists, and its one line of copy. Everything here is a pure read of
// `src/constants.ts`: the entries are the id lists the rest of the game runs
// on, so a weapon, a passive, an enemy, a gem, and a pickup are described
// once and the almanac shows exactly what the night holds.
//
// The screen's geometry is `src/menus.ts` and the drawing is
// `src/render/almanac.ts`; this module knows nothing of either, so the
// pointer's hit test and the renderer read the same entries.

import {
  ALMANAC_TABS,
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

/** One entry of one tab: the thing the detail pane describes. */
export type AlmanacEntry =
  | { readonly kind: "weapon"; readonly id: WeaponId }
  | { readonly kind: "passive"; readonly id: PassiveId }
  | { readonly kind: "enemy"; readonly id: EnemyId }
  | { readonly kind: "gem"; readonly id: GemTier }
  | { readonly kind: "pickup"; readonly id: PickupKind };

/** One line of an entry's figures: the label written as `specs/ui.md` writes it. */
export interface AlmanacStat {
  readonly label: string;
  readonly figure: string;
}

/** The labels `specs/ui.md` fixes for the stat lines. */
export const STAT_LABELS = {
  damage: "DAMAGE",
  cooldown: "COOLDOWN",
  maxLevel: "MAX LEVEL",
  health: "HEALTH",
  speed: "SPEED",
  experience: "EXPERIENCE",
  heals: "HEALS",
} as const;

/** The entries of each tab, in `ALMANAC_TABS` order. */
export const ALMANAC_ENTRIES: readonly (readonly AlmanacEntry[])[] = [
  [...BASE_WEAPON_IDS, ...EVOLUTION_IDS].map((id) => ({
    kind: "weapon" as const,
    id,
  })),
  PASSIVE_IDS.map((id) => ({ kind: "passive" as const, id })),
  ENEMY_IDS.map((id) => ({ kind: "enemy" as const, id })),
  [
    ...GEM_TIERS.map((id) => ({ kind: "gem" as const, id })),
    ...PICKUP_KINDS.map((id) => ({ kind: "pickup" as const, id })),
  ],
];

/** The tab at `tab`, held within `ALMANAC_TABS`. */
export function tabIndex(tab: number): number {
  return Math.max(0, Math.min(ALMANAC_TABS.length - 1, Math.trunc(tab)));
}

/** The entries the tab at `tab` lists, in order. */
export function entriesOf(tab: number): readonly AlmanacEntry[] {
  return ALMANAC_ENTRIES[tabIndex(tab)];
}

/** The entry at `index` of the tab at `tab`, or `null` past its end. */
export function entryAt(tab: number, index: number): AlmanacEntry | null {
  return entriesOf(tab)[index] ?? null;
}

/** The entry's display name. */
export function nameOf(entry: AlmanacEntry): string {
  switch (entry.kind) {
    case "weapon":
      return WEAPON_NAMES[entry.id];
    case "passive":
      return PASSIVES[entry.id].name;
    case "enemy":
      return ENEMIES[entry.id].name;
    case "gem":
      return GEM_NAMES[entry.id];
    case "pickup":
      return PICKUP_NAMES[entry.id];
  }
}

/** The entry's one line of copy. */
export function descriptionOf(entry: AlmanacEntry): string {
  switch (entry.kind) {
    case "weapon":
      return WEAPON_DESCRIPTIONS[entry.id];
    case "passive":
      return PASSIVE_DESCRIPTIONS[entry.id];
    case "enemy":
      return ENEMY_DESCRIPTIONS[entry.id];
    case "gem":
      return GEM_DESCRIPTIONS[entry.id];
    case "pickup":
      return PICKUP_DESCRIPTIONS[entry.id];
  }
}

/**
 * The figures the entry lists. A weapon reads its level `1` row, which for an
 * evolved weapon is its fixed row, and Chandelier, whose row carries no
 * cooldown, shows its damage alone; a chest and a draft carry no figure.
 */
export function statsOf(entry: AlmanacEntry): readonly AlmanacStat[] {
  switch (entry.kind) {
    case "weapon": {
      const row = rowFor(entry.id, 1);
      const stats: AlmanacStat[] = [
        { label: STAT_LABELS.damage, figure: `${row.damage}` },
      ];
      if (row.cooldown !== undefined) {
        stats.push({
          label: STAT_LABELS.cooldown,
          figure: `${row.cooldown}s`,
        });
      }
      return stats;
    }
    case "passive":
      return [
        {
          label: STAT_LABELS.maxLevel,
          figure: `${PASSIVES[entry.id].maxLevel}`,
        },
      ];
    case "enemy": {
      const enemy = ENEMIES[entry.id];
      return [
        { label: STAT_LABELS.health, figure: `${enemy.hp}` },
        { label: STAT_LABELS.speed, figure: `${enemy.speed}` },
        { label: STAT_LABELS.damage, figure: `${enemy.damage}` },
      ];
    }
    case "gem":
      return [
        {
          label: STAT_LABELS.experience,
          figure: `${GEM_VALUES[entry.id]}`,
        },
      ];
    case "pickup":
      return entry.id === "bread"
        ? [{ label: STAT_LABELS.heals, figure: `${BREAD_HEAL}` }]
        : [];
  }
}
