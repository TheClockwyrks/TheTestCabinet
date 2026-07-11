/**
 * Sunfront — asset loading (specs/assets.md).
 *
 * Loads the provided models and muzzle-flash effects through the provided runtimes,
 * page-relative, and turns them into the typed per-type {@link RigTemplate}s the
 * renderer and simulation consume. Nothing here writes a glTF loader, an animation
 * mixer, or a particle simulator — it fetches each entity's `rig.json` and its
 * `meshes/*.glb` parts and decodes them with `@test-cabinet/voxel-runtime`
 * (`parseGlb` + the `/three` `buildPartGeometry`), reusing ONE geometry per
 * (entity type, part), and loads each `effects/*.json` as a `ParticleSystem` played
 * later with `@test-cabinet/particle-runtime` (specs/assets.md).
 *
 * Loading rule (specs/assets.md): every URL is **page-relative** (no leading `/`),
 * resolved against the document base, so the built site loads its models under a
 * per-run sub-path exactly as at a server root.
 */

import * as THREE from "three";
import { parseGlb, buildPartGeometry, poseRig } from "./runtime";
import type { ModelSpec, AnimationSpec, ParticleSystem, PartMesh } from "./runtime";
import type {
  LoadedAssets,
  MuzzleKind,
  MuzzleMount,
  RigBounds,
  RigTemplate,
  UnitType,
  SpawnerType,
} from "./types";

/** One entity's entry in `assets/models.json`. */
interface ManifestEntity {
  model: string;
  kind: string;
  dimensions: [number, number, number];
  clips: Record<string, string>;
  muzzle?: string | null;
}

/** The shape of `assets/models.json` (specs/assets.md). */
interface ModelsManifest {
  version: number;
  effects: Record<string, string>;
  units: Record<string, ManifestEntity>;
  special: Record<string, ManifestEntity>;
  structures: Record<string, ManifestEntity>;
  spawners: Record<string, ManifestEntity>;
}

/** The seeded assets tree lives under `assets/` beside the page (specs/assets.md). */
const ASSETS_ROOT = new URL("assets/", document.baseURI);

/** Resolve a manifest-relative path to a page-relative absolute URL. */
function assetUrl(rel: string): string {
  return new URL(rel, ASSETS_ROOT).href;
}

/** The directory of a `model` path (e.g. `scarab/rig.json` -> `scarab`). */
function dirOf(modelPath: string): string {
  const i = modelPath.lastIndexOf("/");
  return i < 0 ? "" : modelPath.slice(0, i);
}

async function fetchJson<T>(rel: string): Promise<T> {
  const res = await fetch(assetUrl(rel));
  if (!res.ok) throw new Error(`Failed to load ${rel}: ${res.status}`);
  return (await res.json()) as T;
}

async function fetchGlb(rel: string): Promise<ArrayBuffer | null> {
  const res = await fetch(assetUrl(rel));
  if (!res.ok) return null; // a missing/socket part has no geometry
  return await res.arrayBuffer();
}

/**
 * Fallback keywords per game role, used only when the manifest's `clips` map names
 * an animation the rig does not actually contain. The seeded rigs do not all follow
 * the manifest's naming convention (many name their locomotion clip `walk`, their
 * attack `smash`/`bite`/`bombard_fire`, their idle a decorative spin), so the loader
 * resolves each role against the real rig by (1) the manifest name, then (2) the
 * first animation whose name contains one of these keywords — never hard-coding a
 * single name (specs/assets.md). Keep the manifest authoritative when it is right.
 */
const ROLE_FALLBACK_KEYWORDS: Record<string, readonly string[]> = {
  idle: ["idle", "hover", "spin", "breathe", "bob", "pulse", "track", "sweep"],
  move: ["march", "walk", "fly", "stride", "run", "move", "hover", "strafe", "track"],
  attack: ["fire", "bombard", "smash", "bite", "attack", "shoot", "heal", "pulse", "aim", "flak", "lance", "strafe"],
  brace: ["brace", "guard", "crouch"],
  emit: ["emit", "hatch", "pour", "ramp", "door", "stamp", "launch", "raise", "drop", "swing", "bloom", "charge", "turn", "slide"],
  idle_auto: ["radar_spin", "spin", "idle"],
};

/**
 * Resolve every game role in the manifest's `clips` map to a real {@link AnimationSpec}
 * on the rig: the manifest name if it exists, otherwise a keyword fallback, otherwise
 * (for `idle`) the rig's `autoPlay` clip or its first animation. Also fills `idle` and
 * `move` even if the manifest omitted them, so the renderer always has something to
 * play. Returns a role -> animation map.
 */
function resolveClips(
  id: string,
  rig: ModelSpec,
  manifestClips: Record<string, string>,
): Map<string, AnimationSpec> {
  const anims = rig.animations ?? [];
  const byName = new Map<string, AnimationSpec>();
  for (const anim of anims) byName.set(anim.name, anim);

  const clips = new Map<string, AnimationSpec>();
  const roles = new Set<string>([...Object.keys(manifestClips), "idle", "move"]);
  for (const role of roles) {
    const wanted = manifestClips[role];
    let anim = wanted ? byName.get(wanted) : undefined;
    if (!anim) {
      const kws = ROLE_FALLBACK_KEYWORDS[role] ?? [];
      anim = anims.find((a) => kws.some((k) => a.name.includes(k)));
    }
    if (!anim && role === "idle") anim = anims.find((a) => a.autoPlay) ?? anims[0];
    if (anim) {
      clips.set(role, anim);
      if (wanted && anim.name !== wanted) {
        console.info(`[assets] ${id}: role "${role}" -> "${wanted}" absent; using "${anim.name}"`);
      }
    }
  }
  return clips;
}

/**
 * Compute the rest-pose world-space bounds of an assembled rig from its decoded part
 * meshes: pose the rig at rest with the runtime's own posing math, transform each
 * part's vertices by its world matrix, and union the extents. The renderer uses this
 * to ground each instance (`minY`) and centre its footprint on its position, because
 * the rigs are sculpted in a positive octant, not about their own centre.
 */
function computeBounds(rig: ModelSpec, meshes: Map<string, PartMesh>): RigBounds {
  const posed = poseRig(rig, { caller: {}, timeMs: 0 });
  const world = new Map(posed.map((p) => [p.name, p.worldMatrix]));
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [name, mesh] of meshes) {
    const m = world.get(name);
    if (!m) continue;
    const p = mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
    }
  }
  if (!Number.isFinite(minX)) {
    return { minY: 0, centerX: 0, centerZ: 0, sizeX: 0, sizeY: 0, sizeZ: 0 };
  }
  return {
    minY,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    sizeX: maxX - minX,
    sizeY: maxY - minY,
    sizeZ: maxZ - minZ,
  };
}

/**
 * Build one entity's {@link RigTemplate}: fetch the `rig.json`, decode each part's
 * `.glb` into a reused geometry (and keep the decoded {@link PartMesh} for the
 * `VoxelRig` singletons), resolve the authored animation for each game role from the
 * manifest's `clips` map (specs/assets.md — read the real animation name from the
 * rig, keyed via the role map, never hard-coded), and measure the rig's rest bounds.
 */
async function loadRigTemplate(id: string, entry: ManifestEntity): Promise<RigTemplate> {
  const rig = await fetchJson<ModelSpec>(entry.model);
  const dir = dirOf(entry.model);

  const meshes = new Map<string, PartMesh>();
  const geometries = new Map<string, THREE.BufferGeometry>();
  await Promise.all(
    rig.parts.map(async (part) => {
      const data = await fetchGlb(`${dir}/meshes/${part.name}.glb`);
      if (!data) return;
      const mesh = parseGlb(data);
      if (mesh.positions.length === 0) return; // empty attach socket
      meshes.set(part.name, mesh);
      geometries.set(part.name, buildPartGeometry(mesh));
    }),
  );

  const clips = resolveClips(id, rig, entry.clips);
  const bounds = computeBounds(rig, meshes);
  const muzzle = (entry.muzzle ?? null) as MuzzleKind | null;
  const muzzleMounts = resolveMuzzleMounts(id, rig, meshes, muzzle);

  return {
    id,
    rig,
    geometries,
    meshes,
    clips,
    dimensions: entry.dimensions,
    bounds,
    muzzleMounts,
    muzzle,
  };
}

/**
 * Part-name keywords, in priority order, for locating a firing unit's muzzle-bearing
 * part when the rig does not name a joint `muzzle` outright. The seeded rigs carry the
 * muzzle on a barrel / rifle / lance / cannon part; we anchor the flash to the forward
 * tip of the first part whose name contains one of these (specs/assets.md — read the
 * muzzle from the model, don't hard-code a single name).
 */
const MUZZLE_PART_KEYWORDS: readonly string[] = [
  "muzzle", "barrel", "barrels", "cannon_barrel", "rifle", "lance", "cannon", "gun",
];

/** The Aegis fires from three turrets (specs/waves.md); these are their barrel parts. */
const AEGIS_MUZZLE_PARTS: readonly string[] = ["cannon_barrel", "sgun_l", "sgun_r"];

/**
 * Build a {@link MuzzleMount} for one rig part: the forward tip of the part's geometry
 * (its on-axis, forward-most point, in the part's own model coordinates, so it tracks
 * the barrel as it poses) plus the part's girth for scaling the effect to the muzzle.
 * The rigs are sculpted facing model `+z` (the same forward the effects are authored
 * along), so the muzzle tip is the part's forward-most (`maxZ`) point on its centre.
 */
function muzzleMountFor(
  meshes: ReadonlyMap<string, PartMesh>,
  part: string,
  kind: MuzzleKind,
): MuzzleMount | null {
  const mesh = meshes.get(part);
  if (!mesh || mesh.positions.length === 0) return null;
  const p = mesh.positions;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return null;
  const local: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, maxZ];
  const scale = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  return { kind, part, local, scale };
}

/**
 * Resolve the firing points on a rig (specs/assets.md). Melee/support units and
 * structures have none (manifest `muzzle` is `null`/absent); the Aegis has one per
 * turret barrel; every other firing unit anchors its single flash to its muzzle part.
 */
function resolveMuzzleMounts(
  id: string,
  rig: ModelSpec,
  meshes: ReadonlyMap<string, PartMesh>,
  kind: MuzzleKind | null,
): MuzzleMount[] {
  if (!kind) return [];
  if (id === "aegis") {
    const mounts: MuzzleMount[] = [];
    for (const part of AEGIS_MUZZLE_PARTS) {
      const m = muzzleMountFor(meshes, part, kind);
      if (m) mounts.push(m);
    }
    return mounts;
  }
  // A single-barrel firing unit: a part literally named `muzzle`, else the first
  // barrel/rifle/lance/cannon part (in keyword priority), else the rig's last part.
  let part = rig.parts.find((pt) => pt.name === "muzzle")?.name;
  if (!part) {
    for (const kw of MUZZLE_PART_KEYWORDS) {
      const hit = rig.parts.find((pt) => pt.name.includes(kw) && meshes.has(pt.name));
      if (hit) { part = hit.name; break; }
    }
  }
  if (!part) part = rig.parts[rig.parts.length - 1]?.name;
  const mount = part ? muzzleMountFor(meshes, part, kind) : null;
  if (!mount) {
    console.info(`[assets] ${id}: muzzle "${kind}" declared but no muzzle part resolved`);
    return [];
  }
  return [mount];
}

/** The three muzzle-flash families the manifest names (specs/assets.md). */
const MUZZLE_KINDS: readonly MuzzleKind[] = ["small-arms", "cannon", "lance"];

/**
 * Load the entire Sunfront asset bundle: every unit, the Aegis, the structures, the
 * spawners, and the muzzle-flash systems. Call once at boot; the returned templates
 * are shared across all instances (specs/assets.md).
 */
export async function loadAssets(): Promise<LoadedAssets> {
  const manifest = await fetchJson<ModelsManifest>("models.json");

  // Muzzle-flash particle systems, keyed by family.
  const effects = new Map<MuzzleKind, ParticleSystem>();
  await Promise.all(
    MUZZLE_KINDS.map(async (kind) => {
      const rel = manifest.effects[kind];
      if (rel) effects.set(kind, await fetchJson<ParticleSystem>(rel));
    }),
  );

  // Buildable units.
  const units = new Map<UnitType, RigTemplate>();
  await Promise.all(
    Object.entries(manifest.units).map(async ([id, entry]) => {
      units.set(id as UnitType, await loadRigTemplate(id, entry));
    }),
  );

  // The Aegis (special).
  const aegis = await loadRigTemplate("aegis", manifest.special.aegis);

  // Fixed structures (base, reliquary, solar-extractor).
  const structures = new Map<string, RigTemplate>();
  await Promise.all(
    Object.entries(manifest.structures).map(async ([id, entry]) => {
      structures.set(id, await loadRigTemplate(id, entry));
    }),
  );

  // Spawner buildings, keyed by the unit they emit.
  const spawners = new Map<SpawnerType, RigTemplate>();
  await Promise.all(
    Object.entries(manifest.spawners).map(async ([id, entry]) => {
      spawners.set(id as SpawnerType, await loadRigTemplate(id, entry));
    }),
  );

  return { units, aegis, structures, spawners, effects };
}
