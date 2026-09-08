// Deepcore — the value vocabularies and state shapes the simulation, the renderer,
// and the asset loader agree on.
//
// Numeric tuning lives in constants.ts; this file is the type contract between the
// modules that share it.

// ---------------------------------------------------------------------------
// The mine (specs/world.md)
// ---------------------------------------------------------------------------

/** The four depth bands the minable rows are divided into. */
export type Band = "topsoil" | "rockbed" | "deepstone" | "coreshell";

/** Every cell is one of these kinds. A minable cell becomes a tunnel once drilled out. */
export type TileKind =
  | "rock"
  | "ore"
  | "material"
  | "gas"
  | "lava"
  | "stone"
  | "bedrock"
  | "tunnel"
  | "core";

export interface Tile {
  kind: TileKind;
  /** The band this cell's rock belongs to, which fixes its fill and its health. */
  band: Band;
  /** Which ore an ore cell holds. */
  ore?: Ore;
  /** Which exotic material a material node holds. */
  material?: "resonite" | "cryenite";
  /**
   * Remaining health, seeded to the band's BAND_HEALTH the first time the cell is
   * drilled. Damage persists on the cell, so an abandoned cut resumes from here.
   */
  health?: number;
}

// ---------------------------------------------------------------------------
// Ore and materials (specs/mining.md)
// ---------------------------------------------------------------------------

/** The ten mineral ores and the three gemstones, which behave alike once collected. */
export type Ore =
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
  | "verdite"
  | "roselite"
  | "aurite";

/** The three exotic materials the rocket consumes. */
export type Material = "resonite" | "cryenite" | "core-sample";

/** Ore held in the cargo bay, counted per type. */
export type Cargo = Record<Ore, number>;

/** The satchel, which weighs nothing and takes no cargo slot. */
export interface Satchel {
  resonite: number;
  cryenite: number;
  /** At most one Core Sample is ever carried. */
  coreSample: boolean;
}

// ---------------------------------------------------------------------------
// Field supplies (specs/items.md)
// ---------------------------------------------------------------------------

export type ItemId =
  | "dynamite"
  | "plastic-explosives"
  | "quantum-teleporter"
  | "matter-transmitter"
  | "nanobots"
  | "emergency-fuel";

/** Held field-supply counts, one entry per supply. */
export type ItemCounts = Record<ItemId, number>;

/** An item resting on a cell. A jettisoned Core Sample is the only one. */
export interface GroundItem {
  kind: "core-sample";
  col: number;
  row: number;
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

/** The current tier on each track. */
export type UpgradeTiers = Record<UpgradeTrack, number>;

// ---------------------------------------------------------------------------
// The rocket (specs/rocket.md)
// ---------------------------------------------------------------------------

export type RocketComponentId =
  | "hull-frame"
  | "fuel-cells"
  | "guidance"
  | "thruster"
  | "ignition";

// ---------------------------------------------------------------------------
// The prospector (specs/character.md)
// ---------------------------------------------------------------------------

/** Which way the miner's sprite faces. The west facing is the east one mirrored. */
export type Facing = "east" | "west";

/** The miner's animation states, one produced cycle each. */
export type MinerState =
  | "idle"
  | "walk"
  | "drill-down"
  | "drill-side"
  | "jetpack"
  | "fall"
  | "hurt"
  | "fuel-out";

export interface DrillProgress {
  col: number;
  row: number;
  dir: "down" | "left" | "right";
  /**
   * Seconds until the next hit lands. The target cell's remaining health lives on the
   * cell, so it survives the cut being abandoned; this only paces the hits.
   */
  hitTimer: number;
}

export interface Miner {
  /** The top-left of the miner's box, in world units. Continuous, never snapped. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: Facing;
  state: MinerState;
  fuel: number;
  hull: number;
  /** Non-null while a cut is in progress. */
  drilling: DrillProgress | null;
  /** Whether the miner's body moves. Held by the travel faculty gate. */
  travel: boolean;
  /** Whether the miner's drill cuts. Held by the drill faculty gate. */
  drill: boolean;
}

// ---------------------------------------------------------------------------
// The expedition (specs/expedition.md, specs/modes.md)
// ---------------------------------------------------------------------------

export type Mode = "standard" | "hardcore";

export type DeathCause = "fuel-out" | "hull-destroyed" | "core-detonation";

/** The eight screens the game is in exactly one of. */
export type Screen =
  | "title"
  | "mode-select"
  | "size-select"
  | "how-to-play"
  | "in-mine"
  | "paused"
  | "victory"
  | "game-over";

/** The six panels, of which only the inventory opens away from a building. */
export type Panel =
  | "fuel-depot"
  | "ore-market"
  | "upgrade-shop"
  | "supply-depot"
  | "launch-pad"
  | "inventory";

/** The open panel, or null while none is. */
export type OpenPanel = Panel | null;

/** A surface building. The Save Pad is the one that opens no panel. */
export type BuildingId =
  | "fuel-depot"
  | "ore-market"
  | "save-pad"
  | "upgrade-shop"
  | "supply-depot"
  | "launch-pad";

/** The two hazards that raise a one-time notice card. */
export type Hazard = "gas" | "lava";

/** What the Victory and Game Over screens summarize. It is not persisted. */
export interface RunSummary {
  deepestDepthMeters: number;
  creditsEarned: number;
  elapsedSeconds: number;
  mode: Mode;
  componentsInstalled: number;
  deathCause: DeathCause | null;
}
