// Arc Foundry — the look: the palette, the type face, and the words drawn on screen.
//
// `src/constants.ts` deliberately fixes no color, no font, and no artwork, because
// `specs/overview.md` states what a player must read at a glance and leaves how it
// looks to the build. This module is that choice, gathered in one place so the yard,
// the HUD, the panel, and the menus are lit by one palette rather than by scattered
// literals.
//
// The scheme is electro-industrial: a cold, oil-dark yard lit by blue-white discharge,
// with one accent per base component type so a type reads by color as well as by its
// produced head sprite, and one accent per quality rung so the ladder reads as a ring
// and a Roman badge beside the escalating finish of the sprite itself.

import {
  COMPONENT_TYPES,
  MAX_QUALITY,
  QUALITY_TIERS,
  TARGETING_PRIORITIES,
  type ComboId,
  type ComponentType,
  type DifficultyId,
  type MapId,
  type TargetingPriority,
} from "./constants";

/** The palette. Every color the game draws comes from here. */
export const COL = {
  /** The letterbox and the ground behind everything. */
  void: "#05080c",
  substrate: "#0d141b",
  concrete: "#141d26",
  grid: "#1d2b38",
  flow: "#2f6d92",
  /** The blue-white of a live arc. */
  arc: "#8fdcff",
  spark: "#eaf6ff",
  /** Charge, the currency. */
  charge: "#ffcf4a",
  /** Grid Integrity, the lives. */
  integrity: "#46d6e6",
  /** The feeder vent the Load spills from. */
  entry: "#ffd15a",
  /** The grounding sink it is heading for. */
  collector: "#ff6a4a",
  /** A map's fixed transformer housings. */
  housing: "#37485a",
  legal: "#46d07a",
  illegal: "#ff4d4d",
  alert: "#ff5a52",
  boss: "#c65cff",
  panel: "#0f1620",
  text: "#e8eef5",
  text2: "#93a2b2",
  text3: "#5d6b7a",
  /** The combination-tower badge. */
  combo: "#ffe9a8",
  /** An inert fused-scrap blocker. */
  blocker: "#3a4351",
} as const;

/** One accent per base component type, so a type reads by color as well as by shape. */
export const TYPE_COLOR: Readonly<Record<ComponentType, string>> = {
  capacitor: "#5ac8ff",
  coil: "#9b7bff",
  emitter: "#7fe6b0",
  arcnode: "#ffb347",
  discharge: "#ff5470",
  /** Slow, as electromagnetic drag: icy cyan. */
  choke: "#66d9e8",
  /** Burn, as an overcurrent: ember orange. */
  rectifier: "#ff6b3d",
  /** Support, which never fires: lime. */
  regulator: "#b6e05a",
};

/**
 * One accent per quality rung, indexed by `quality - 1`.
 *
 * The second, non-color read of quality is the Roman badge below and the escalating
 * finish of the produced head sprite itself, so a player who cannot separate these
 * five hues still reads the ladder.
 */
export const QUALITY_COLOR: readonly string[] = [
  "#7a8794",
  "#8fd0a0",
  "#6cb6ff",
  "#c78cff",
  "#ffe45a",
];

/** The quality badge, indexed by `quality - 1`. */
export const QUALITY_ROMAN: readonly string[] = ["I", "II", "III", "IV", "V"];

/** A quality rung's name as the panel draws it, indexed by `quality - 1`. */
export const QUALITY_LABEL: readonly string[] = QUALITY_TIERS.map((t) =>
  t.name.toUpperCase(),
);

/** A base type's name as the panel draws it. */
export const TYPE_LABEL: Readonly<Record<ComponentType, string>> =
  Object.fromEntries(
    COMPONENT_TYPES.map((type) => [
      type,
      type === "arcnode"
        ? "ARC-NODE"
        : type === "discharge"
          ? "DISCHARGE RIG"
          : type.toUpperCase(),
    ]),
  ) as Record<ComponentType, string>;

/** A targeting priority as the panel draws it. */
export const TARGETING_LABEL: Readonly<Record<TargetingPriority, string>> =
  Object.fromEntries(
    TARGETING_PRIORITIES.map((p) => [p, p.toUpperCase()]),
  ) as Record<TargetingPriority, string>;

/**
 * The type face. A monospace stack, because the HUD is a column of figures that must
 * stay in line as they change, with generic fallbacks so the layout holds wherever the
 * page is opened.
 */
export const FONT =
  '"SF Mono", "JetBrains Mono", "Fira Mono", "DejaVu Sans Mono", "Menlo", "Consolas", monospace';

/** The drawn radius of each Load type, in logical units. Appearance, not rule. */
export const LOAD_RADIUS: Readonly<Record<string, number>> = {
  mote: 10,
  spark: 8,
  slug: 13,
  cluster: 7,
  filament: 9,
  dynamo: 20,
  /** The finale's core looms larger than the campaign boss it resembles. */
  overload: 28,
};

/** A quality rung, clamped into `1..MAX_QUALITY`, for indexing the tables above. */
export function qualityIndex(quality: number): number {
  return Math.max(0, Math.min(MAX_QUALITY - 1, Math.round(quality) - 1));
}

/**
 * One accent per combination tower: the base type its identity leans on, so a tower
 * reads as a keystone built out of something recognizable, with the apex taking the
 * combo gold itself.
 */
export const COMBO_COLOR: Readonly<Record<ComboId, string>> = {
  fusecluster: TYPE_COLOR.arcnode,
  staticweb: TYPE_COLOR.coil,
  slagdriver: TYPE_COLOR.discharge,
  corroder: TYPE_COLOR.rectifier,
  ionprism: TYPE_COLOR.rectifier,
  forkarray: TYPE_COLOR.emitter,
  nullcore: TYPE_COLOR.regulator,
  rupturenode: TYPE_COLOR.arcnode,
  blightcoil: TYPE_COLOR.rectifier,
  reactorpile: TYPE_COLOR.coil,
  auroralance: TYPE_COLOR.choke,
  singularity: COL.combo,
};

/** One accent per difficulty, on the select cards. */
export const DIFFICULTY_COLOR: Readonly<Record<DifficultyId, string>> = {
  easy: COL.legal,
  medium: COL.charge,
  hard: COL.alert,
};

/** A one-word read of each map's shape, drawn on its select card. */
export const MAP_STYLE: Readonly<Record<MapId, string>> = {
  substation: "SERPENTINE",
  switchyard: "BUSBAR",
  transformer: "CHOKEPOINT",
};

/** A sentence on what each map's topology asks of a maze, drawn on its select card. */
export const MAP_BLURB: Readonly<Record<MapId, string>> = {
  substation:
    "A perimeter spiral: fold the route down the edges, then in through the center to the right-side sink.",
  switchyard:
    "A crossing star: six legs cut back and forth through the middle, so the center band is the premium maze.",
  transformer:
    "Two fixed transformer housings split the yard, and the center waypoint threads the gap as the route loops the corridors.",
};
