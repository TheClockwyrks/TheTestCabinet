// Deepcore — shared domain types.
//
// These are the value vocabularies and state shapes the simulation, renderer, and
// asset loader agree on. Numeric tuning lives in constants.ts; this file is the type
// contract. Sources: specs/world.md, specs/character.md, specs/mining.md,
// specs/hazards.md, specs/upgrades.md, specs/rocket.md, specs/flow.md, specs/modes.md.

// ---------------------------------------------------------------------------
// World (specs/world.md)
// ---------------------------------------------------------------------------

/** The four depth bands (the Core chamber is handled separately as row 96). */
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
  /** True once a minable cell has been drilled out (redundant with kind === tunnel). */
  mined?: boolean;
}

// ---------------------------------------------------------------------------
// Ore & materials (specs/mining.md)
// ---------------------------------------------------------------------------

export type Ore =
  | "ferron"
  | "cuprite"
  | "argenite"
  | "voltite"
  | "pyronium"
  | "adamite";

/** The three exotic materials the rocket needs (Core Sample is unstable). */
export type Material = "resonite" | "cryenite" | "core-sample";

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
  /** Seconds elapsed on the current tile. */
  elapsed: number;
  /** Total drill time for this tile (hardness / power). */
  total: number;
}

// ---------------------------------------------------------------------------
// Modes & how a death occurred (specs/modes.md, specs/hazards.md)
// ---------------------------------------------------------------------------

export type Mode = "standard" | "hardcore";

export type DeathCause = "fuel-out" | "hull-destroyed" | "core-detonation";

// ---------------------------------------------------------------------------
// Game states (specs/flow.md)
// ---------------------------------------------------------------------------

export type GamePhase =
  | "title"
  | "mode-select"
  | "how-to-play"
  | "in-mine"
  | "paused"
  | "victory"
  | "game-over";

/**
 * Which overlay panel is open, if any. The first four are the surface buildings (opened
 * only at the camp); `save-pad` is the fifth surface building; `inventory` is the cargo
 * hold, openable ANYWHERE (surface or mid-dig) to review and drop ore (specs/mining.md,
 * specs/flow.md).
 */
export type OpenPanel =
  | null
  | "fuel-depot"
  | "ore-market"
  | "upgrade-shop"
  | "launch-pad"
  | "save-pad"
  | "inventory";

/** End-screen run summary (specs/flow.md — not persisted). */
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
