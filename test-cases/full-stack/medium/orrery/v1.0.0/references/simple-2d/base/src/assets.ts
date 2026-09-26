// Orrery — loading the produced files through the engine (specs/assets.md,
// ASSET-LAYOUT.md).
//
// Every sprite, sheet frame, particle system, cue, and the music bed was
// produced with the asset tools during this build and committed under
// `assets/`; nothing here invokes a tool, and neither `npm ci` nor
// `npm run build` does.
//
// The ENGINE resolves every path. Its loader resolves under one root,
// `assets/`, relative to the page the build is served from, so this build asks
// for `sprites/motes/sol.png` — the path `src/constants.ts` states — and never
// constructs a URL of its own. That is what makes the built site run unchanged
// from the root of a static host and from a sub-path alike. The cues are bound
// to their files the same way, through the cue bus in `src/audio.ts`.
//
// A load that fails leaves the game running. A sprite that did not arrive is
// simply absent from the store and the drawing falls back to what it draws in
// code; a particle system that did not arrive leaves its effect playing
// nothing. A missing file costs the game its polish rather than its
// playability (specs/assets.md).

import type { ParticleSystem } from "@clockwyrks/particle-runtime";
import type { InitApi } from "@clockwyrks/simple-2d";
import {
  APERTURE_FRAMES,
  APERTURE_SHEETS,
  FILAMENT_SPRITE_PATHS,
  FIXTURE_MOUNT_PATH,
  GRIPPER_PATHS,
  HUB_PATHS,
  INSTRUCTION_GLYPH_PATHS,
  MOTE_SPRITE_PATHS,
  PARTICLE_PATHS,
  SIGIL_GLYPH_PATHS,
  WHEEL_HUB_PATH,
} from "./constants";
import type { ParticleSystemName } from "./figures";

/** One frame of an aperture sheet, by its path under the asset root. */
export function aperturePath(sheet: "rise" | "set", frame: number): string {
  return `${APERTURE_SHEETS[sheet]}/${frame}.png`;
}

/**
 * Every sprite path the drawing asks for, so the loader decodes the whole set
 * once before the first frame (specs/assets.md).
 */
export function spritePaths(): string[] {
  const paths: string[] = [
    ...Object.values(MOTE_SPRITE_PATHS),
    ...Object.values(FILAMENT_SPRITE_PATHS),
    ...Object.values(SIGIL_GLYPH_PATHS),
    ...Object.values(INSTRUCTION_GLYPH_PATHS),
    ...Object.values(HUB_PATHS),
    ...Object.values(GRIPPER_PATHS),
    WHEEL_HUB_PATH,
    FIXTURE_MOUNT_PATH,
  ];
  for (const sheet of ["rise", "set"] as const) {
    for (let frame = 0; frame < APERTURE_FRAMES; frame += 1) {
      paths.push(aperturePath(sheet, frame));
    }
  }
  return paths;
}

/**
 * Decode every produced sprite through the engine's loader, keyed by the path
 * `src/constants.ts` names it under. Each load is guarded on its own, so one
 * file that will not arrive leaves the rest of the set decoded.
 */
export async function loadSprites(
  api: Pick<InitApi, "assets">,
  paths: readonly string[] = spritePaths(),
): Promise<Map<string, ImageBitmap>> {
  const decoded = new Map<string, ImageBitmap>();
  await Promise.all(
    paths.map(async (path) => {
      try {
        decoded.set(path, await api.assets.loadImage(path));
      } catch {
        // A sprite whose file will not load or decode is simply not drawn.
      }
    }),
  );
  return decoded;
}

/**
 * Load and parse the three produced particle systems. A file that does not
 * arrive or parse simply leaves its system out, and that effect plays nothing.
 */
export async function loadSystems(
  api: Pick<InitApi, "assets">,
): Promise<Map<ParticleSystemName, ParticleSystem>> {
  const systems = new Map<ParticleSystemName, ParticleSystem>();
  await Promise.all(
    (Object.keys(PARTICLE_PATHS) as ParticleSystemName[]).map(async (name) => {
      try {
        const blob = await api.assets.load(PARTICLE_PATHS[name]);
        const parsed: unknown = JSON.parse(await blob.text());
        if (isSystem(parsed)) systems.set(name, parsed);
      } catch {
        // The system stays out, and the game plays on without the effect.
      }
    }),
  );
  return systems;
}

/** Whether a loaded document is a particle system the player can play. */
export function isSystem(value: unknown): value is ParticleSystem {
  if (typeof value !== "object" || value === null) return false;
  const system = value as Partial<ParticleSystem>;
  return (
    typeof system.durationMs === "number" &&
    typeof system.field === "object" &&
    Array.isArray(system.emitters)
  );
}
