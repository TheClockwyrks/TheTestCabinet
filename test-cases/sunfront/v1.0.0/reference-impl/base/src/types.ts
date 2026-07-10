/**
 * Sunfront — shared game types.
 *
 * The vocabulary the whole build shares: teams, the armor/attack counter system
 * (specs/units.md), the unit/structure/spawner rosters, and the loaded-asset
 * templates the renderer and simulation draw from. Later phases add the live
 * simulation state (units, structures, projectiles, the wave clock, the AI) on top
 * of these; this file is the vocabulary, not the mutable state.
 */

import type { ModelSpec, AnimationSpec, ParticleSystem, PartMesh } from "./runtime";

/** The two legions. The player always holds the origin corner (specs/playfield.md). */
export type Team = "player" | "enemy";

/** An armor class a unit wears (specs/units.md counter matrix). */
export type Armor = "Light" | "Heavy" | "Air";

/** An attack type a weapon deals (specs/units.md counter matrix). */
export type AttackType = "Normal" | "Piercing" | "Splash" | "Flak" | "Support";

/** The ten buildable unit types (specs/units.md), keyed by their stable id. */
export type UnitType =
  | "scarab"
  | "trooper"
  | "sentinel"
  | "bulwark"
  | "lancer"
  | "bombard"
  | "flakhound"
  | "sunhawk"
  | "lumen"
  | "monolith";

/** Every entity kind that has a buildable spawner (one per unit type). */
export type SpawnerType = UnitType;

/** The three muzzle-flash effect families (specs/assets.md). */
export type MuzzleKind = "small-arms" | "cannon" | "lance";

/** The pre-placed, non-build-grid structures. */
export type FixedStructureType = "base" | "reliquary";

/** A build-grid structure the player places (specs/economy.md). */
export type BuildStructureType = SpawnerType | "solar-extractor";

/** The static, per-type combat stats read from specs/units.md at spawner level 1. */
export interface UnitStats {
  readonly type: UnitType;
  /** Build cost of the spawner that emits this unit (specs/economy.md). */
  readonly cost: number;
  readonly hp: number;
  readonly armor: Armor;
  readonly attack: AttackType;
  /** Base damage per shot (Support units deal none). */
  readonly damage: number;
  /** Seconds between shots; `null` for the no-weapon Lumen. */
  readonly cadenceS: number | null;
  /** Attack/heal range in logical units. */
  readonly range: number;
  /** Movement speed in logical units per second. */
  readonly speedUps: number;
  /** Minimum range (Bombard = 70); `0` for everything else. */
  readonly minRange: number;
  /** Splash radius for Splash attackers, else `0` (Monolith 60, Bombard 55). */
  readonly splashRadius: number;
  /** Which muzzle-flash family this unit plays per shot, or `null` for melee/support. */
  readonly muzzle: MuzzleKind | null;
  /** Human-facing display name and one-line role, for the HUD build palette. */
  readonly name: string;
  readonly role: string;
}

/** The game states (specs/flow.md). */
export type GameState =
  | "title"
  | "how-to-play"
  | "in-match"
  | "paused"
  | "match-over";

/**
 * A loaded, ready-to-instance rig template for one entity type (a unit, structure,
 * spawner, or the Aegis). Built once at load (specs/assets.md): the parsed rig, one
 * reusable `THREE.BufferGeometry` per non-empty part, the resolved authored
 * animations keyed by the game role from `models.json`'s `clips` map, and the
 * authored dimensions (the on-field relative-scale contract).
 */
export interface RigTemplate {
  /** The stable id (unit type / structure id / `aegis`), for diagnostics. */
  readonly id: string;
  /** The parsed `rig.json` (ModelSpec). */
  readonly rig: ModelSpec;
  /**
   * One geometry per part that has geometry, keyed by part name. Empty/socket parts
   * are absent. REUSE across every instance of this type (specs/assets.md — the
   * whole point of the rigid uniform roster). Consumed by the GPU-instanced unit
   * renderer, which builds one `THREE.InstancedMesh` per (type, part) from these.
   */
  readonly geometries: ReadonlyMap<string, import("three").BufferGeometry>;
  /**
   * One decoded {@link PartMesh} per non-empty part, keyed by part name — the same
   * geometry as {@link geometries} but in the runtime's framework-agnostic form,
   * kept so the few one-off singletons (bases, reliquaries, extractors, spawners, the
   * Aegis) can be rendered with the runtime's `VoxelRig` directly (specs/assets.md).
   */
  readonly meshes: ReadonlyMap<string, PartMesh>;
  /** The authored animations resolved by game role (e.g. `move`, `attack`, `idle`). */
  readonly clips: ReadonlyMap<string, AnimationSpec>;
  /** Authored extents `[width, height, depth]` in model units (the scale contract). */
  readonly dimensions: readonly [number, number, number];
  /**
   * The rest-pose world-space bounds of the assembled rig, in model units — used to
   * ground each instance on the floor (`minY`) and centre its footprint on its
   * ground position (`centerX`/`centerZ`), since the rigs are sculpted in a positive
   * octant rather than about their own centre.
   */
  readonly bounds: RigBounds;
  /** The muzzle joint name for firing units (specs/assets.md), or `null`. */
  readonly muzzleJoint: string | null;
  /** Which muzzle-flash family this entity plays, or `null`. */
  readonly muzzle: MuzzleKind | null;
}

/** The assembled rest-pose extents of a rig in its own model units. */
export interface RigBounds {
  readonly minY: number;
  readonly centerX: number;
  readonly centerZ: number;
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
}

/**
 * One entity's per-frame render state, the handoff from the simulation (phases 4+)
 * to the renderer. The renderer never reads simulation state directly — it draws
 * exactly this list each frame: which rig template to pose, where it stands and
 * faces on the ground plane, its animation clock and active clip role, any
 * caller-driven joint overrides (e.g. an Aegis turret yaw), and a destruction flash.
 */
export interface RenderEntity {
  /** Stable per-entity id (kept stable so an instance keeps its slot frame to frame). */
  readonly id: number;
  /** The owning team, or `neutral` for the Reliquary's own colour. */
  readonly team: Team | "neutral";
  /** Ground-plane position (specs/playfield.md). */
  readonly x: number;
  readonly z: number;
  /** Render-only height off the floor (0 for ground units; > 0 for the Air Sunhawk). */
  readonly altitude: number;
  /** Facing yaw about `+y`, radians. */
  readonly yaw: number;
  /** Animation clock in milliseconds for the active clip. */
  readonly animMs: number;
  /** The active clip role to play (`move` / `attack` / `idle` / `emit`). */
  readonly role: string;
  /** Caller-driven joint overrides composed over the active clip (turrets, aim). */
  readonly caller?: Record<string, number>;
  /** Destruction white-flash amount `0..1` (specs/assets.md — flash then remove). */
  readonly flash?: number;
  /** Veteran level marker: brighten the team accent when set (specs/economy.md). */
  readonly accent?: boolean;
}

/** The fully loaded asset bundle handed to the renderer and simulation. */
export interface LoadedAssets {
  /** Rig templates for the ten buildable units. */
  readonly units: ReadonlyMap<UnitType, RigTemplate>;
  /** The Aegis rig template. */
  readonly aegis: RigTemplate;
  /** Rig templates for the fixed structures (base, reliquary, solar-extractor). */
  readonly structures: ReadonlyMap<string, RigTemplate>;
  /** Rig templates for the ten spawner buildings, keyed by the unit they emit. */
  readonly spawners: ReadonlyMap<SpawnerType, RigTemplate>;
  /** The three muzzle-flash particle systems, keyed by family. */
  readonly effects: ReadonlyMap<MuzzleKind, ParticleSystem>;
}
