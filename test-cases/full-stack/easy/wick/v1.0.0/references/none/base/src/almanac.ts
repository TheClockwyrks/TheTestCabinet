// Wick — what the almanac lists and what it says of each entry (specs/ui.md
// "`almanac`").
//
// Four tabs over one entry type each: the sixteen tools, the ten trinkets,
// the thirteen enemies, and the six gems and pickups. Every entry carries the
// name its row and its detail pane draw, the produced picture beside it, the
// labelled figures under it, and its one line of copy. The figures are read
// from the tables `constants.ts` fixes, so the almanac reports exactly what
// the game plays. The window rules the list scrolls by live here too, since
// they are counted over these entries.

import {
  ALMANAC_ROWS,
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

/** The labels the detail pane writes its figures under. */
export const STAT_LABELS = {
  damage: "DAMAGE",
  cooldown: "COOLDOWN",
  maxLevel: "MAX LEVEL",
  health: "HEALTH",
  speed: "SPEED",
  experience: "EXPERIENCE",
  heals: "HEALS",
} as const;

/** The produced picture an entry shows, by what it is a picture of. */
export type AlmanacPicture =
  | { readonly of: "tool"; readonly weapon: WeaponId }
  | { readonly of: "trinket"; readonly passive: PassiveId }
  | { readonly of: "enemy"; readonly enemy: EnemyId }
  | { readonly of: "gem"; readonly tier: GemTier }
  | { readonly of: "pickup"; readonly pickup: PickupKind };

/** One labelled figure of an entry. */
export interface AlmanacStat {
  readonly label: string;
  readonly value: string;
}

/** One entry of one tab. */
export interface AlmanacEntry {
  readonly name: string;
  readonly picture: AlmanacPicture;
  readonly stats: readonly AlmanacStat[];
  readonly description: string;
}

const stat = (label: string, value: number | string): AlmanacStat => ({
  label,
  value: String(value),
});

/** The tools: the ten base weapons, then the six evolutions. */
function tools(): AlmanacEntry[] {
  return [...BASE_WEAPON_IDS, ...EVOLUTION_IDS].map((weapon): AlmanacEntry => {
    // The level `1` row, which for an evolved weapon is its fixed one.
    const row = rowFor(weapon, 1);
    return {
      name: WEAPON_NAMES[weapon],
      picture: { of: "tool", weapon },
      stats:
        row.cooldown === undefined
          ? [stat(STAT_LABELS.damage, row.damage)]
          : [
              stat(STAT_LABELS.damage, row.damage),
              stat(STAT_LABELS.cooldown, `${row.cooldown}s`),
            ],
      description: WEAPON_DESCRIPTIONS[weapon],
    };
  });
}

/** The trinkets: the ten passives. */
function trinkets(): AlmanacEntry[] {
  return PASSIVE_IDS.map((passive): AlmanacEntry => ({
    name: PASSIVES[passive].name,
    picture: { of: "trinket", passive },
    stats: [stat(STAT_LABELS.maxLevel, PASSIVES[passive].maxLevel)],
    description: PASSIVE_DESCRIPTIONS[passive],
  }));
}

/** The enemies: the thirteen of the night, commons through the Dark. */
function enemies(): AlmanacEntry[] {
  return ENEMY_IDS.map((enemy): AlmanacEntry => {
    const def = ENEMIES[enemy];
    return {
      name: def.name,
      picture: { of: "enemy", enemy },
      stats: [
        stat(STAT_LABELS.health, def.hp),
        stat(STAT_LABELS.speed, def.speed),
        stat(STAT_LABELS.damage, def.damage),
      ],
      description: ENEMY_DESCRIPTIONS[enemy],
    };
  });
}

/** The pickups: the three gem tiers, then the three pickups. */
function pickups(): AlmanacEntry[] {
  const gems = GEM_TIERS.map((tier): AlmanacEntry => ({
    name: GEM_NAMES[tier],
    picture: { of: "gem", tier },
    stats: [stat(STAT_LABELS.experience, GEM_VALUES[tier])],
    description: GEM_DESCRIPTIONS[tier],
  }));
  const items = PICKUP_KINDS.map((pickup): AlmanacEntry => ({
    name: PICKUP_NAMES[pickup],
    picture: { of: "pickup", pickup },
    stats: pickup === "bread" ? [stat(STAT_LABELS.heals, BREAD_HEAL)] : [],
    description: PICKUP_DESCRIPTIONS[pickup],
  }));
  return [...gems, ...items];
}

/** Every tab's entries, in `ALMANAC_TABS` order. Built once; nothing here changes. */
const TABS: readonly (readonly AlmanacEntry[])[] = [
  tools(),
  trinkets(),
  enemies(),
  pickups(),
];

/** The entries the tab at `tab` lists, in order; empty off the tab bar. */
export function almanacEntries(tab: number): readonly AlmanacEntry[] {
  return TABS[tab] ?? [];
}

/** The tab index `delta` away from `tab`, wrapping at both ends. */
export function wrapTab(tab: number, delta: number): number {
  const length = ALMANAC_TABS.length;
  return (tab + delta + length) % length;
}

/** A scroll held between `0` and the last row a list of `count` can start on. */
export function clampScroll(scroll: number, count: number): number {
  return Math.max(0, Math.min(scroll, Math.max(0, count - ALMANAC_ROWS)));
}

/**
 * The scroll that keeps `index` in view: it comes no later than the highlight
 * and no earlier than `ALMANAC_ROWS` before it, then is clamped to the list.
 */
export function followHighlight(
  scroll: number,
  index: number,
  count: number,
): number {
  const near = Math.min(scroll, index);
  return clampScroll(Math.max(near, index - ALMANAC_ROWS + 1), count);
}

/** How many rows the list shows of a tab holding `count` entries. */
export function visibleRows(count: number): number {
  return Math.max(0, Math.min(ALMANAC_ROWS, count));
}
