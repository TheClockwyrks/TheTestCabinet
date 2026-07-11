/**
 * Sunfront — materials and the wireframe registry (specs/overview.md).
 *
 * Two shared, lit materials tint the whole roster: one `MeshStandardMaterial` for the
 * GPU-instanced units (its per-instance `instanceColor` carries the team tint) and a
 * cloned tinted material per one-off singleton. Every material the scene creates —
 * units, singletons, terrain — registers here so the **F4 wireframe toggle**
 * (specs/overview.md) can flip them all at once, exposing the underlying 3D geometry.
 */

import * as THREE from "three";
import { PALETTE, TEAM_COLORS } from "../constants";
import type { Team } from "../types";

/** A material collection with a single wireframe switch (specs/overview.md, F4). */
export class MaterialRegistry {
  private readonly materials = new Set<THREE.Material & { wireframe?: boolean }>();
  private readonly listeners = new Set<(on: boolean) => void>();
  private wire = false;

  /** Register a material so the wireframe toggle reaches it; returns it for chaining. */
  add<T extends THREE.Material>(material: T): T {
    this.materials.add(material as THREE.Material & { wireframe?: boolean });
    if ("wireframe" in material) (material as { wireframe: boolean }).wireframe = this.wire;
    return material;
  }

  /**
   * Subscribe to wireframe-state changes (specs/overview.md — F4 must also reach the
   * runtime-generated muzzle-flash effects, whose transient materials are not registered
   * here). Returns an unsubscribe fn; the callback fires immediately with the current
   * state so a subscriber starts in sync.
   */
  onWireframe(cb: (on: boolean) => void): () => void {
    this.listeners.add(cb);
    cb(this.wire);
    return () => this.listeners.delete(cb);
  }

  /** Whether wireframe mode is on. */
  get wireframe(): boolean {
    return this.wire;
  }

  /** Turn wireframe rendering on or off across every registered material. */
  setWireframe(on: boolean): void {
    this.wire = on;
    for (const m of this.materials) {
      if ("wireframe" in m) (m as { wireframe: boolean }).wireframe = on;
    }
    for (const cb of this.listeners) cb(on);
  }

  /** Flip wireframe mode; returns the new state. */
  toggleWireframe(): boolean {
    this.setWireframe(!this.wire);
    return this.wire;
  }
}

/** The shared lit material for the instanced units (team tint via `instanceColor`). */
export function createUnitMaterial(registry: MaterialRegistry): THREE.MeshStandardMaterial {
  return registry.add(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0.0,
    }),
  );
}

/** A tinted lit material for one singleton, multiplying its voxel colours by `hex`. */
export function createTintedMaterial(
  registry: MaterialRegistry,
  hex: string,
): THREE.MeshStandardMaterial {
  return registry.add(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0.0,
      color: new THREE.Color(hex),
    }),
  );
}

/** The team base tint (Ember / Azure), or the neutral Reliquary colour. */
export function teamTint(team: Team | "neutral"): string {
  if (team === "neutral") return PALETTE.neutral;
  return TEAM_COLORS[team].base;
}

const scratchColor = new THREE.Color();
const white = new THREE.Color(0xffffff);

/**
 * The per-instance colour for a unit: its team tint, lerped toward white by its
 * destruction `flash` (specs/assets.md — flash a few times, then remove). Writes into
 * and returns {@link out} to avoid per-instance allocation.
 */
export function instanceColor(
  out: THREE.Color,
  team: Team | "neutral",
  flash = 0,
  accent = false,
): THREE.Color {
  out.set(teamTint(team));
  if (accent) out.lerp(white, 0.25); // veteran level marker: brighten the tint
  if (flash > 0) scratchColor.copy(out).lerp(white, Math.min(1, flash));
  return flash > 0 ? out.copy(scratchColor) : out;
}
