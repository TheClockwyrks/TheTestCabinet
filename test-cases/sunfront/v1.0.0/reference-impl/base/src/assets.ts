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
import { parseGlb, buildPartGeometry } from "./runtime";
import type { ModelSpec, AnimationSpec, ParticleSystem } from "./runtime";
import type {
  LoadedAssets,
  MuzzleKind,
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
 * Build one entity's {@link RigTemplate}: fetch the `rig.json`, decode each part's
 * `.glb` into a reused geometry, and resolve the authored animation for each game
 * role from the manifest's `clips` map (specs/assets.md — always read the real
 * animation name from the rig, keyed via the role map, never hard-coded).
 */
async function loadRigTemplate(id: string, entry: ManifestEntity): Promise<RigTemplate> {
  const rig = await fetchJson<ModelSpec>(entry.model);
  const dir = dirOf(entry.model);

  const geometries = new Map<string, THREE.BufferGeometry>();
  await Promise.all(
    rig.parts.map(async (part) => {
      const data = await fetchGlb(`${dir}/meshes/${part.name}.glb`);
      if (!data) return;
      const mesh = parseGlb(data);
      if (mesh.positions.length === 0) return; // empty attach socket
      geometries.set(part.name, buildPartGeometry(mesh));
    }),
  );

  const byName = new Map<string, AnimationSpec>();
  for (const anim of rig.animations ?? []) byName.set(anim.name, anim);
  const clips = new Map<string, AnimationSpec>();
  for (const [role, name] of Object.entries(entry.clips)) {
    const anim = byName.get(name);
    if (anim) clips.set(role, anim);
    else console.warn(`[assets] ${id}: clip role "${role}" -> "${name}" not in rig`);
  }

  const muzzleJoint = rig.parts.some((p) => p.name === "muzzle") ? "muzzle" : null;

  return {
    id,
    rig,
    geometries,
    clips,
    dimensions: entry.dimensions,
    muzzleJoint,
    muzzle: (entry.muzzle ?? null) as MuzzleKind | null,
  };
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
