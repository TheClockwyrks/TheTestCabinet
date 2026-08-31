// Wick — every figure the specification fixes, named once.
//
// The stage and the tick, the lamplighter, the weapon tables and the evolved
// rows, the passive terms, the progression figures, the enemy roster, the
// spawn windows and the scripted events, the actions and their bindings, the
// screen copy, the cue names, and the paths the produced files land at. The
// look of the night is not among them.

// ---- The stage and the tick ------------------------------------------------

export const STAGE_W = 1280;
export const STAGE_H = 720;
export const STAGE_CX = 640;
export const STAGE_CY = 360;

export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
export const DAWN_TIME = 600;
/** The tick on which the night ends: `DAWN_TIME × TICK_HZ`. */
export const DAWN_TICK = DAWN_TIME * TICK_HZ;

export const DEFAULT_SEED = 1;
export const WICK_DEBUG_VERSION = 1;

// ---- The lamplighter -------------------------------------------------------

export const MOVE_SPEED = 180;
export const PLAYER_RADIUS = 12;
export const BASE_MAX_HP = 100;
export const BASE_RECOVERY = 0;
export const PICKUP_RADIUS = 48;

export const CONTACT_COOLDOWN = 0.5;
export const MIN_DAMAGE_TAKEN = 1;

// ---- Gems and pickups ------------------------------------------------------

export const GEM_TIERS = ["small", "medium", "large"] as const;
export type GemTier = (typeof GEM_TIERS)[number];
export const GEM_VALUES: Readonly<Record<GemTier, number>> = {
  small: 1,
  medium: 3,
  large: 10,
};
export const GEM_SPEED = 600;
export const COLLECT_RADIUS = 8;

export const PICKUP_KINDS = ["chest", "bread", "draft"] as const;
export type PickupKind = (typeof PICKUP_KINDS)[number];
export const PICKUP_ITEM_RADIUS = 16;
export const BREAD_HEAL = 30;
export const BREAD_CHANCE = 0.02;
export const DRAFT_CHANCE = 0.005;

// ---- Weapons ---------------------------------------------------------------

export const BASE_WEAPON_IDS = [
  "taper",
  "ember",
  "pin",
  "lantern",
  "halo",
  "oil-splash",
  "spark",
  "shard",
  "sconce",
  "flare",
] as const;
export type BaseWeaponId = (typeof BASE_WEAPON_IDS)[number];

export const EVOLUTION_IDS = [
  "pyre",
  "beacon",
  "hail",
  "chandelier",
  "corona",
  "blaze",
] as const;
export type EvolutionId = (typeof EVOLUTION_IDS)[number];

export type WeaponId = BaseWeaponId | EvolutionId;

export const WEAPON_NAMES: Readonly<Record<WeaponId, string>> = {
  taper: "Taper",
  ember: "Ember",
  pin: "Pin",
  lantern: "Lantern",
  halo: "Halo",
  "oil-splash": "Oil Splash",
  spark: "Spark",
  shard: "Shard",
  sconce: "Sconce",
  flare: "Flare",
  pyre: "Pyre",
  beacon: "Beacon",
  hail: "Hail",
  chandelier: "Chandelier",
  corona: "Corona",
  blaze: "Blaze",
};

export const MAX_WEAPON_LEVEL = 8;
export const MIN_COOLDOWN = 0.2;
export const INFINITE_PIERCE = -1;
export const TAPER_MAX_AMOUNT = 2;

export const SLASH_FLASH = 0.1;
export const SPARK_FLASH = 0.2;
export const FLARE_FLASH = 0.4;

export const PIN_SPREAD = 10;
export const SHARD_SPREAD = 15;
export const SCONCE_SPREAD = 20;
export const SCONCE_DECEL = 600;
export const OIL_SCATTER = 400;
export const SPARK_RANGE = 600;
export const LANTERN_ANGULAR_SPEED = 180;

export const OIL_PULSE = 0.3;
export const BLAZE_PULSE = 0.2;
export const LANTERN_REHIT = 0.5;
export const SHARD_REHIT = 0.5;
export const SCONCE_REHIT = 0.5;

export const FLARE_IMMUNE: readonly EnemyId[] = ["dark"];

/**
 * One row of a weapon's figures. A column a weapon's table lacks is absent;
 * a length a weapon has no use for is left `undefined`.
 */
export interface WeaponRow {
  readonly damage: number;
  readonly cooldown?: number;
  readonly speed?: number;
  readonly radius?: number;
  readonly pierce?: number;
  readonly duration?: number;
  readonly amount?: number;
  readonly width?: number;
  readonly height?: number;
  readonly orbit?: number;
  readonly area?: number;
}

const taper = (
  damage: number,
  cooldown: number,
  width: number,
  height: number,
  amount: number,
): WeaponRow => ({ damage, cooldown, width, height, amount });

export const TAPER_LEVELS: readonly WeaponRow[] = [
  taper(10, 1.35, 120, 40, 1),
  taper(15, 1.35, 120, 40, 1),
  taper(15, 1.35, 120, 40, 2),
  taper(15, 1.35, 140, 48, 2),
  taper(20, 1.35, 140, 48, 2),
  taper(20, 1.2, 140, 48, 2),
  taper(25, 1.2, 140, 48, 2),
  taper(30, 1.2, 160, 56, 2),
];

const bolt = (
  damage: number,
  cooldown: number,
  speed: number,
  radius: number,
  pierce: number,
  duration: number,
  amount: number,
): WeaponRow => ({ damage, cooldown, speed, radius, pierce, duration, amount });

export const EMBER_LEVELS: readonly WeaponRow[] = [
  bolt(10, 1.2, 400, 8, 0, 2.0, 1),
  bolt(10, 1.2, 400, 8, 0, 2.0, 2),
  bolt(10, 1.0, 400, 8, 0, 2.0, 2),
  bolt(15, 1.0, 400, 8, 0, 2.0, 2),
  bolt(15, 1.0, 400, 8, 1, 2.0, 2),
  bolt(15, 1.0, 400, 8, 1, 2.0, 3),
  bolt(20, 0.9, 400, 8, 1, 2.0, 3),
  bolt(25, 0.8, 450, 10, 2, 2.0, 3),
];

export const PIN_LEVELS: readonly WeaponRow[] = [
  bolt(6, 0.5, 600, 6, 1, 1.5, 1),
  bolt(6, 0.5, 600, 6, 1, 1.5, 2),
  bolt(8, 0.5, 600, 6, 1, 1.5, 2),
  bolt(8, 0.5, 600, 6, 2, 1.5, 3),
  bolt(10, 0.5, 600, 6, 2, 1.5, 3),
  bolt(10, 0.4, 600, 6, 2, 1.5, 4),
  bolt(12, 0.4, 600, 6, 3, 1.5, 4),
  bolt(15, 0.35, 700, 7, 3, 1.5, 5),
];

const lantern = (
  damage: number,
  cooldown: number,
  orbit: number,
  radius: number,
  duration: number,
  amount: number,
): WeaponRow => ({ damage, cooldown, orbit, radius, duration, amount });

export const LANTERN_LEVELS: readonly WeaponRow[] = [
  lantern(10, 3.0, 90, 14, 3.0, 1),
  lantern(10, 3.0, 90, 14, 3.0, 2),
  lantern(15, 3.0, 90, 14, 3.0, 2),
  lantern(15, 3.0, 100, 16, 3.5, 2),
  lantern(15, 3.0, 100, 16, 3.5, 3),
  lantern(20, 2.5, 100, 16, 3.5, 3),
  lantern(20, 2.5, 110, 18, 4.0, 3),
  lantern(25, 2.5, 120, 20, 4.0, 4),
];

const aura = (damage: number, cooldown: number, radius: number): WeaponRow => ({
  damage,
  cooldown,
  radius,
});

export const HALO_LEVELS: readonly WeaponRow[] = [
  aura(3, 1.0, 80),
  aura(3, 1.0, 90),
  aura(4, 1.0, 90),
  aura(4, 0.8, 100),
  aura(5, 0.8, 100),
  aura(5, 0.8, 110),
  aura(6, 0.7, 110),
  aura(8, 0.6, 120),
];

const puddle = (
  damage: number,
  cooldown: number,
  radius: number,
  duration: number,
  amount: number,
): WeaponRow => ({ damage, cooldown, radius, duration, amount });

export const OIL_SPLASH_LEVELS: readonly WeaponRow[] = [
  puddle(4, 3.0, 50, 2.5, 1),
  puddle(4, 3.0, 50, 2.5, 2),
  puddle(5, 3.0, 55, 2.5, 2),
  puddle(5, 2.5, 55, 3.0, 2),
  puddle(6, 2.5, 60, 3.0, 3),
  puddle(6, 2.5, 60, 3.5, 3),
  puddle(7, 2.0, 65, 3.5, 3),
  puddle(8, 2.0, 70, 4.0, 4),
];

const strike = (
  damage: number,
  cooldown: number,
  area: number,
  amount: number,
): WeaponRow => ({ damage, cooldown, area, amount });

export const SPARK_LEVELS: readonly WeaponRow[] = [
  strike(15, 2.0, 40, 1),
  strike(15, 2.0, 40, 2),
  strike(20, 2.0, 40, 2),
  strike(20, 1.8, 50, 2),
  strike(25, 1.8, 50, 3),
  strike(25, 1.6, 50, 3),
  strike(30, 1.6, 60, 3),
  strike(40, 1.4, 70, 4),
];

const flier = (
  damage: number,
  cooldown: number,
  speed: number,
  radius: number,
  duration: number,
  amount: number,
): WeaponRow => ({
  damage,
  cooldown,
  speed,
  radius,
  pierce: INFINITE_PIERCE,
  duration,
  amount,
});

export const SHARD_LEVELS: readonly WeaponRow[] = [
  flier(8, 2.5, 500, 8, 3.0, 1),
  flier(8, 2.5, 500, 8, 3.5, 1),
  flier(10, 2.5, 500, 8, 3.5, 2),
  flier(10, 2.2, 500, 8, 4.0, 2),
  flier(12, 2.2, 500, 8, 4.0, 2),
  flier(12, 2.0, 550, 9, 4.5, 3),
  flier(15, 2.0, 550, 9, 4.5, 3),
  flier(20, 1.8, 600, 10, 5.0, 3),
];

export const SCONCE_LEVELS: readonly WeaponRow[] = [
  flier(12, 2.0, 600, 12, 2.5, 1),
  flier(12, 2.0, 600, 12, 2.5, 2),
  flier(16, 2.0, 600, 12, 2.5, 2),
  flier(16, 1.8, 600, 14, 2.5, 2),
  flier(20, 1.8, 600, 14, 2.5, 3),
  flier(20, 1.6, 600, 14, 2.5, 3),
  flier(24, 1.6, 600, 16, 2.5, 3),
  flier(30, 1.4, 600, 16, 2.5, 4),
];

export const FLARE_LEVELS: readonly WeaponRow[] = [
  aura(100, 60, 640),
  aura(100, 55, 640),
  aura(150, 55, 640),
  aura(150, 50, 640),
  aura(200, 50, 640),
  aura(200, 45, 640),
  aura(300, 45, 640),
  aura(500, 40, 640),
];

export const WEAPON_LEVELS: Readonly<
  Record<BaseWeaponId, readonly WeaponRow[]>
> = {
  taper: TAPER_LEVELS,
  ember: EMBER_LEVELS,
  pin: PIN_LEVELS,
  lantern: LANTERN_LEVELS,
  halo: HALO_LEVELS,
  "oil-splash": OIL_SPLASH_LEVELS,
  spark: SPARK_LEVELS,
  shard: SHARD_LEVELS,
  sconce: SCONCE_LEVELS,
  flare: FLARE_LEVELS,
};

// ---- Evolutions ------------------------------------------------------------

export interface Evolution {
  readonly from: BaseWeaponId;
  readonly passive: PassiveId;
}

export const EVOLUTIONS: Readonly<Record<EvolutionId, Evolution>> = {
  pyre: { from: "taper", passive: "wick" },
  beacon: { from: "ember", passive: "oil" },
  hail: { from: "pin", passive: "mirror" },
  chandelier: { from: "lantern", passive: "glass" },
  corona: { from: "halo", passive: "tinder" },
  blaze: { from: "oil-splash", passive: "soot" },
};

export const PYRE_STATS: WeaponRow = taper(60, 1.2, 200, 60, 2);
export const BEACON_STATS: WeaponRow = bolt(20, 0.25, 500, 10, 2, 2.0, 1);
export const HAIL_STATS: WeaponRow = bolt(15, 0.5, 700, 7, 3, 1.5, 6);
export const CHANDELIER_STATS: WeaponRow = {
  damage: 25,
  orbit: 120,
  radius: 20,
  amount: 4,
};
export const CORONA_STATS: WeaponRow = aura(12, 0.5, 150);
export const BLAZE_STATS: WeaponRow = puddle(8, 2.0, 70, 4.0, 5);

export const EVOLUTION_STATS: Readonly<Record<EvolutionId, WeaponRow>> = {
  pyre: PYRE_STATS,
  beacon: BEACON_STATS,
  hail: HAIL_STATS,
  chandelier: CHANDELIER_STATS,
  corona: CORONA_STATS,
  blaze: BLAZE_STATS,
};

export const PYRE_HEAL = 1;
export const CORONA_HEAL = 1;
export const CHEST_HEAL = 30;

// ---- Passives --------------------------------------------------------------

export const PASSIVE_IDS = [
  "wick",
  "oil",
  "glass",
  "brass",
  "mirror",
  "bellows",
  "tallow",
  "tinder",
  "soot",
  "lure",
] as const;
export type PassiveId = (typeof PASSIVE_IDS)[number];

export interface PassiveDef {
  readonly name: string;
  readonly maxLevel: number;
}

export const PASSIVES: Readonly<Record<PassiveId, PassiveDef>> = {
  wick: { name: "Wick", maxLevel: 5 },
  oil: { name: "Oil", maxLevel: 5 },
  glass: { name: "Glass", maxLevel: 5 },
  brass: { name: "Brass", maxLevel: 3 },
  mirror: { name: "Mirror", maxLevel: 2 },
  bellows: { name: "Bellows", maxLevel: 5 },
  tallow: { name: "Tallow", maxLevel: 5 },
  tinder: { name: "Tinder", maxLevel: 5 },
  soot: { name: "Soot", maxLevel: 5 },
  lure: { name: "Lure", maxLevel: 5 },
};

export const WICK_DAMAGE_PER_LEVEL = 0.1;
export const OIL_COOLDOWN_PER_LEVEL = 0.08;
export const GLASS_AREA_PER_LEVEL = 0.1;
export const BRASS_ARMOR_PER_LEVEL = 1;
export const MIRROR_AMOUNT_PER_LEVEL = 1;
export const BELLOWS_SPEED_PER_LEVEL = 0.1;
export const TALLOW_HP_PER_LEVEL = 15;
export const TINDER_RECOVERY_PER_LEVEL = 0.5;
export const SOOT_XP_PER_LEVEL = 0.1;
export const LURE_PICKUP_PER_LEVEL = 0.25;

// ---- Progression -----------------------------------------------------------

export const WEAPON_SLOTS = 6;
export const PASSIVE_SLOTS = 6;
export const XP_BASE = 5;
export const XP_STEP = 10;
export const OFFER_COUNT = 3;
export const LAMP_OIL_ID = "lamp-oil";
export const LAMP_OIL_NAME = "Lamp Oil";
export const LAMP_OIL_HEAL = 30;

export type OfferId = BaseWeaponId | PassiveId | typeof LAMP_OIL_ID;

// ---- Enemies ---------------------------------------------------------------

export const ENEMY_IDS = [
  "moth",
  "bat",
  "rat",
  "gnat",
  "beetle",
  "wisp",
  "spider",
  "crow",
  "shade",
  "hound",
  "mothwing",
  "owl",
  "dark",
] as const;
export type EnemyId = (typeof ENEMY_IDS)[number];

export type EnemyRank = "common" | "elite" | "dark";
export type EnemyBehavior = "chase" | "drift" | "weave";

export interface EnemyDef {
  readonly name: string;
  readonly rank: EnemyRank;
  readonly hp: number;
  readonly speed: number;
  readonly damage: number;
  readonly radius: number;
  /** The gem a common enemy drops; an elite drops a chest, the Dark nothing. */
  readonly gem: GemTier | null;
  readonly behavior: EnemyBehavior;
}

const common = (
  name: string,
  hp: number,
  speed: number,
  damage: number,
  radius: number,
  gem: GemTier,
  behavior: EnemyBehavior,
): EnemyDef => ({
  name,
  rank: "common",
  hp,
  speed,
  damage,
  radius,
  gem,
  behavior,
});

export const ENEMIES: Readonly<Record<EnemyId, EnemyDef>> = {
  moth: common("Moth", 5, 100, 5, 10, "small", "chase"),
  bat: common("Bat", 8, 140, 5, 10, "small", "chase"),
  rat: common("Rat", 15, 120, 8, 12, "small", "chase"),
  gnat: common("Gnat", 2, 160, 3, 8, "small", "drift"),
  beetle: common("Beetle", 25, 60, 10, 14, "medium", "chase"),
  wisp: common("Wisp", 12, 90, 6, 10, "medium", "weave"),
  spider: common("Spider", 40, 80, 12, 14, "medium", "chase"),
  crow: common("Crow", 30, 150, 10, 12, "medium", "chase"),
  shade: common("Shade", 60, 70, 15, 16, "medium", "chase"),
  hound: common("Hound", 120, 110, 20, 18, "large", "chase"),
  mothwing: {
    name: "Mothwing",
    rank: "elite",
    hp: 600,
    speed: 90,
    damage: 20,
    radius: 28,
    gem: null,
    behavior: "chase",
  },
  owl: {
    name: "Owl",
    rank: "elite",
    hp: 2000,
    speed: 100,
    damage: 30,
    radius: 36,
    gem: null,
    behavior: "chase",
  },
  dark: {
    name: "The Dark",
    rank: "dark",
    hp: 10000,
    speed: 170,
    damage: 50,
    radius: 40,
    gem: null,
    behavior: "chase",
  },
};

export const WISP_AMPLITUDE = 40;
export const WISP_PERIOD = 1.0;
export const HP_SCALE_PER_MINUTE = 0.15;

// ---- The spawn director ----------------------------------------------------

export const SPAWN_DISTANCE = 760;
export const DESPAWN_DISTANCE = 1200;
export const SPAWN_WINDOW = 30;
export const LAST_WINDOW = 19;

export interface SpawnWindowDef {
  readonly types: readonly EnemyId[];
  readonly interval: number;
  readonly cap: number;
}

const window_ = (
  types: readonly EnemyId[],
  interval: number,
  cap: number,
): SpawnWindowDef => ({ types, interval, cap });

export const SPAWN_WINDOWS: readonly SpawnWindowDef[] = [
  window_(["moth"], 1.0, 20),
  window_(["moth", "bat"], 0.8, 30),
  window_(["moth", "bat", "rat"], 0.6, 40),
  window_(["bat", "rat", "beetle"], 0.5, 50),
  window_(["bat", "rat", "beetle"], 0.5, 60),
  window_(["rat", "beetle", "wisp"], 0.4, 70),
  window_(["beetle", "wisp", "spider"], 0.4, 80),
  window_(["wisp", "spider", "crow"], 0.35, 90),
  window_(["spider", "crow", "shade"], 0.3, 100),
  window_(["crow", "shade", "moth"], 0.3, 110),
  window_(["shade", "crow", "hound"], 0.25, 120),
  window_(["bat", "shade", "hound"], 0.25, 130),
  window_(["rat", "spider", "hound"], 0.2, 140),
  window_(["beetle", "crow", "hound"], 0.2, 150),
  window_(["wisp", "shade", "hound"], 0.2, 160),
  window_(["spider", "crow", "hound"], 0.15, 170),
  window_(["crow", "shade", "hound"], 0.15, 180),
  window_(["shade", "hound", "bat"], 0.15, 190),
  window_(["shade", "hound", "crow"], 0.1, 200),
  window_(["hound", "shade", "spider"], 0.1, 200),
];

export type EventKind = "swarm" | "mothwing" | "owl" | "dark";

export interface ScriptedEvent {
  /** Run-clock seconds. */
  readonly time: number;
  readonly kind: EventKind;
}

export const EVENTS: readonly ScriptedEvent[] = [
  { time: 60, kind: "swarm" },
  { time: 120, kind: "mothwing" },
  { time: 240, kind: "swarm" },
  { time: 300, kind: "mothwing" },
  { time: 420, kind: "swarm" },
  { time: 450, kind: "owl" },
  { time: 540, kind: "dark" },
];

export const SWARM_SIZE = 24;
export const SWARM_LINE = 720;

// ---- Controls --------------------------------------------------------------

export const ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "confirm",
  "back",
  "pause",
  "mute",
] as const;
export type Action = (typeof ACTIONS)[number];

export const BINDINGS: Readonly<Record<Action, readonly string[]>> = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["KeyP"],
  mute: ["KeyM"],
};

export const LAYOUT = "dpad-4";
export const OVERLAY_TOGGLE_CODE = "Backquote";

// ---- Screens and copy ------------------------------------------------------

export const SCREENS = [
  "title",
  "howto",
  "playing",
  "levelup",
  "chest",
  "paused",
  "fallen",
  "dawn",
] as const;
export type Screen = (typeof SCREENS)[number];

export type Facing = "left" | "right";

export const ZONE_KINDS = [
  "puddle",
  "lantern",
  "aura",
  "slash",
  "strike",
  "burst",
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

export const TITLE_TEXT = "WICK";
export const TAGLINE_TEXT = "KEEP THE LIGHT";
export const TITLE_ITEMS = ["LIGHT THE LAMP", "HOW TO PLAY"] as const;
export const END_ITEMS = ["TRY AGAIN", "TITLE"] as const;
export const PAUSED_TEXT = "PAUSED";
export const LEVEL_UP_TEXT = "THE LAMP BURNS BRIGHTER";
export const CHEST_TEXT = "A CHEST OPENS";
export const FALLEN_TEXT = "THE LIGHT WENT OUT";
export const DAWN_TEXT = "DAWN";
export const LEVEL_LABEL = "LEVEL";
export const OFFER_NEW_TEXT = "NEW";

// ---- Audio -----------------------------------------------------------------

export const CUES = {
  hit: "hit",
  kill: "kill",
  gem: "gem",
  hurt: "hurt",
  levelUp: "level-up",
  choose: "choose",
  chest: "chest",
  evolve: "evolve",
  pickup: "pickup",
  fallen: "fallen",
  dawn: "dawn",
  menuMove: "menu-move",
  menuConfirm: "menu-confirm",
  music: "music",
  hum: "hum",
} as const;
export type Cue = (typeof CUES)[keyof typeof CUES];

export const CUE_NAMES: readonly Cue[] = Object.values(CUES);
export const LOOPING_CUES: readonly Cue[] = [CUES.music, CUES.hum];

// ---- Produced assets -------------------------------------------------------

export const WALK_FRAME_TIME = 0.1;
export const PUFF_TIME = 0.4;
export const LAMPLIGHTER_WALK_FRAMES = 6;
export const ENEMY_WALK_FRAMES = 4;
export const PUFF_FRAMES = 4;

/** The lamplighter's canvas, in units. */
export const LAMPLIGHTER_SIZE = { width: 24, height: 32 } as const;
export const GEM_SIZES: Readonly<Record<GemTier, number>> = {
  small: 8,
  medium: 12,
  large: 16,
};
export const PICKUP_SIZE = 24;
export const GROUND_TILE = 64;
export const ICON_SIZE = 24;

/** The path of a produced file under `assets/`. */
export const ASSET_PATHS = {
  lamplighterIdle: "sprites/lamplighter/idle.png",
  lamplighterWalk: (frame: number): string =>
    `sprites/lamplighter/walk/${frame}.png`,
  enemy: (id: EnemyId, frame: number): string =>
    `sprites/enemies/${id}/${frame}.png`,
  puff: (frame: number): string => `sprites/puff/${frame}.png`,
  gem: (tier: GemTier): string => `sprites/gems/${tier}.png`,
  pickup: (kind: PickupKind): string => `sprites/pickups/${kind}.png`,
  ground: "sprites/ground.png",
  icon: (id: string): string => `icons/${id}.png`,
  audio: (cue: Cue): string => `audio/${cue}.wav`,
} as const;
