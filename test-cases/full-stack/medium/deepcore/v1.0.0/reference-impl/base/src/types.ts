// Deepcore — shared domain types.
//
// These are the value vocabularies and state shapes the simulation, renderer, and
// asset loader agree on. Numeric tuning lives in constants.ts; this file is the type
// contract. Sources: specs/world.md, specs/character.md, specs/mining.md,
// specs/hazards.md, specs/upgrades.md, specs/rocket.md, specs/gameplay.md, specs/ui.md,
// specs/modes.md.

// ---------------------------------------------------------------------------
// World (specs/world.md)
// ---------------------------------------------------------------------------

/** The four depth bands (the Core chamber is handled separately as row 500). */
export type Band = "topsoil" | "rockbed" | "deepstone" | "coreshell";

/**
 * Every grid cell is one of these kinds. A minable cell becomes `tunnel` once drilled.
 * `rock` carries the band's fill; `ore` and `material` carry their payload; `gas` and
 * `lava` are hazards; `bedrock` is the unminable border/floor/chamber walls.
 */
export type TileKind =
  | "rock" // plain minable rock of the row's band
  | "ore" // minable rock with an ore deposit
  | "material" // minable rock holding a buried exotic material node
  | "gas" // gas pocket (detonates when drilled) — drawn as ordinary band rock (hidden)
  | "lava" // molten hazard, not minable
  | "stone" // unbreakable stone boulder — not minable, impassable, scattered obstacle
  | "bedrock" // unminable border / floor / Core-chamber walls
  | "tunnel" // open space (original gap or drilled-out)
  | "core"; // the glowing Core in its chamber (yields the Core Sample)

export interface Tile {
  kind: TileKind;
  /** The band this cell's rock belongs to (for fill + hardness). */
  band: Band;
  /** For `ore` tiles: which ore is deposited. */
  ore?: Ore;
  /** For `material` tiles: which buried material node this is. */
  material?: Material;
  /**
   * Remaining tile HEALTH (specs/character.md). Undefined until the tile is first drilled,
   * at which point it is seeded to the band's `maxHealth`; each drill hit subtracts the
   * drill's damage-per-hit. Damage PERSISTS on the grid: a tile drilled partway and then
   * abandoned keeps its reduced health (and shows its cracks), so resuming continues from
   * where it left off rather than restarting from full. The tile breaks at `health <= 0`.
   */
  health?: number;
  /** True once a minable cell has been drilled out (redundant with kind === tunnel). */
  mined?: boolean;
}

// ---------------------------------------------------------------------------
// Ore & materials (specs/mining.md)
// ---------------------------------------------------------------------------

export type Ore =
  // The ten mineral ores, shallow → deep (specs/mining.md). Each appears over a depth-frequency
  // curve (constants.ts ORES); the four SIGNATURE ores the upgrade ladder is anchored to are
  // Cuprite / Argenite / Voltite / Pyronium (specs/upgrades.md).
  | "ferron"
  | "marlite"
  | "cuprite"
  | "argenite"
  | "cobaltine"
  | "voltite"
  | "halcite"
  | "pyronium"
  | "cindrite"
  | "adamite"
  // Gemstones — a rarer, cut-crystal find per band below the topsoil (specs/mining.md). Carried,
  // slotted, weighed, and sold exactly like ore; distinguished only by `ORES[o].gem` (rendering,
  // placement, and worth), so every ore-keyed system (cargo, economy, inventory) covers them.
  | "verdite"
  | "roselite"
  | "aurite";

/** The three exotic materials the rocket needs (Core Sample is unstable). */
export type Material = "resonite" | "cryenite" | "core-sample";

// ---------------------------------------------------------------------------
// Field supplies — single-use items (specs/items.md)
// ---------------------------------------------------------------------------

/**
 * The six single-use "field supply" items, bought with Credits at the Supply Depot
 * and carried as a COUNT per type (each use consumes one). Their prices, blast radii,
 * and effect magnitudes are pinned in constants.ts (specs/items.md).
 */
export type ItemId =
  | "dynamite"
  | "plastic-explosives"
  | "quantum-teleporter"
  | "matter-transmitter"
  | "nanobots"
  | "emergency-fuel";

/** Held-item counts, one entry per item type. */
export type ItemCounts = Record<ItemId, number>;

// ---------------------------------------------------------------------------
// Ground items (specs/items.md)
// ---------------------------------------------------------------------------

/**
 * An item dropped on the world grid, sitting on a tile. Today the ONLY ground item is a
 * jettisoned Core Sample (specs/items.md): its destabilization timer keeps running on the
 * ground (the global coreTimer) and it detonates AT its ground location (killing only a
 * miner within the blast). A jettisoned Sample is a one-way discard — it CANNOT be picked
 * back up; another must be drilled from the Core (which is inexhaustible, specs/mining.md).
 */
export interface GroundItem {
  kind: "core-sample";
  col: number;
  row: number;
}

/** Ore held in the cargo bay, counted per type. */
export type Cargo = Record<Ore, number>;

/** The materials satchel: which buried materials the miner currently holds. */
export interface Satchel {
  resonite: number;
  cryenite: number;
  /** At most one Core Sample is ever carried; destroyed on death. */
  coreSample: boolean;
}

// ---------------------------------------------------------------------------
// Upgrades (specs/upgrades.md)
// ---------------------------------------------------------------------------

export type UpgradeTrack =
  | "fuel"
  | "drill"
  | "cargo"
  | "hull"
  | "jetpack"
  | "radiator"
  | "scanner";

/** Current tier (1..5) on each upgrade track. */
export type UpgradeTiers = Record<UpgradeTrack, number>;

// ---------------------------------------------------------------------------
// Rocket (specs/rocket.md)
// ---------------------------------------------------------------------------

export type RocketComponentId =
  | "hull-frame"
  | "fuel-cells"
  | "guidance"
  | "thruster"
  | "ignition";

/** Alias kept for spec-parity naming. */
export type RocketComponent = RocketComponentId;

// ---------------------------------------------------------------------------
// Miner (specs/character.md)
// ---------------------------------------------------------------------------

/** Which way the miner's sprite faces (mirrored for west). */
export type Facing = "east" | "west";

/**
 * The miner's animation states — one produced sprite-sheet cycle per state
 * (specs/character.md, specs/assets.md). These map 1:1 to `assets/miner/<state>/`.
 */
export type MinerState =
  | "idle"
  | "walk"
  | "drill-down"
  | "drill-side"
  | "jetpack"
  | "fall"
  | "hurt"
  | "fuel-out";

export interface Miner {
  /** Continuous logical-pixel position (top-left of the miner's 48x48 box). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: Facing;
  state: MinerState;
  fuel: number;
  hull: number;
  /** Non-null while a drill is in progress; targets a grid cell. */
  drilling: DrillProgress | null;
}

export interface DrillProgress {
  col: number;
  row: number;
  /** Direction the miner is drilling. */
  dir: "down" | "left" | "right";
  /**
   * Seconds until the next drill HIT lands (counts down; on reaching 0 a hit is applied —
   * damage subtracted from the target tile's health, fuel spent — and it is reset by
   * HIT_INTERVAL). The tile's remaining health lives on the Tile itself (so it persists if
   * the cut is abandoned), not here — this only tracks the hit cadence for the active cut.
   */
  hitTimer: number;
}

// ---------------------------------------------------------------------------
// Modes & how a death occurred (specs/modes.md, specs/hazards.md)
// ---------------------------------------------------------------------------

export type Mode = "standard" | "hardcore";

export type DeathCause = "fuel-out" | "hull-destroyed" | "core-detonation";

// ---------------------------------------------------------------------------
// Game states (specs/ui.md)
// ---------------------------------------------------------------------------

export type GamePhase =
  | "title"
  | "mode-select"
  | "size-select"
  | "how-to-play"
  | "in-mine"
  | "paused"
  | "victory"
  | "game-over";

/**
 * Which overlay panel is open, if any. These are the surface buildings that HAVE a menu
 * (opened only at the camp) plus `inventory`, the cargo hold, openable ANYWHERE (surface
 * or mid-dig) to review and drop ore (specs/mining.md, specs/ui.md). The Save Pad has NO
 * menu — activating it banks the expedition directly (specs/gameplay.md), so it is not a panel.
 */
export type OpenPanel =
  | null
  | "fuel-depot"
  | "ore-market"
  | "upgrade-shop"
  | "supply-depot"
  | "launch-pad"
  | "inventory";

/**
 * Identity of a surface building (specs/world.md). Every building except the Save Pad opens
 * an overlay panel of the same name; the Save Pad has no menu (it saves on activation), so
 * its id is not an `OpenPanel`.
 */
export type BuildingId =
  | "fuel-depot"
  | "ore-market"
  | "save-pad"
  | "upgrade-shop"
  | "supply-depot"
  | "launch-pad";

/** End-screen run summary (specs/gameplay.md — not persisted). */
export interface RunSummary {
  deepestDepthMeters: number;
  creditsEarned: number;
  elapsedSeconds: number;
  mode: Mode;
  componentsInstalled: number;
  deathCause?: DeathCause;
}

/** The whole mutable game state the simulation owns. */
export interface GameState {
  phase: GamePhase;
  mode: Mode;
  panel: OpenPanel;
  credits: number;
  creditsEarned: number;
  cargo: Cargo;
  satchel: Satchel;
  tiers: UpgradeTiers;
  installed: Set<RocketComponentId>;
  /** Held single-use field-supply items, counted per type (specs/items.md). */
  items: ItemCounts;
  /** Items dropped on the world grid (today only a jettisoned Core Sample, specs/items.md). */
  groundItems: GroundItem[];
  miner: Miner;
  /** Grid[row][col] tiles. */
  grid: Tile[][];
  /** Horizontal camera offset (world x at the left of the viewport) — the mine is wider
   *  than the viewport, so the camera scrolls across it (specs/world.md). */
  cameraX: number;
  /** Vertical camera offset (world y at the top of the viewport). */
  cameraY: number;
  /** Seconds remaining on the Core Sample timer, or null if not carrying it. */
  coreTimer: number | null;
  deepestRow: number;
  elapsedSeconds: number;
  summary: RunSummary | null;
}

// ---------------------------------------------------------------------------
// Assets manifest (specs/assets.md)
// ---------------------------------------------------------------------------

/**
 * The produced assets, wired in via Vite globs (page-relative URLs — specs/assets.md).
 * Each field is a resolved URL (or an ordered list of frame URLs) the loader hands to
 * the renderer / audio / particle systems. This interface is the canonical wiring
 * contract; the concrete loader in assets.ts populates it from `import.meta.glob`.
 */
export interface AssetManifest {
  /** Miner animation cycles: state → ordered frame URLs (frame00, frame01, …). */
  miner: Record<MinerState, string[]>;
  /** Band + unbreakable-stone + tunnel + bedrock tile sprites, keyed by sprite name. */
  tiles: Record<string, string>;
  /** Drill-damage crack overlay frames (ordered, deepening with the cut). */
  crack: string[];
  /** Ore vein sprites keyed by ore. */
  ore: Record<Ore, string>;
  /** Material-node / core sprites keyed by sprite name. */
  materials: Record<string, string>;
  /** Hazard sprites: lava shimmer (ordered frames). Gas has no tile — it uses band rock. */
  hazards: { lava: string[] };
  /** Surface building + camp sprites keyed by name. */
  surface: Record<string, string>;
  /** Rocket assembly-stage frames, ordered stage0..stage5. */
  rocket: string[];
  /** HUD glyph sprites keyed by name. */
  icons: Record<string, string>;
  /** Particle system.json URLs keyed by effect name. */
  fx: Record<string, string>;
  /** Audio .wav URLs keyed by cue name. */
  audio: Record<string, string>;
}
