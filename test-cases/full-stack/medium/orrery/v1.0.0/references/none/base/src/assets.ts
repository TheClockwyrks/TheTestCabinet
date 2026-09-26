// Orrery — reaching the produced files (specs/assets.md).
//
// Every sprite, sheet frame, particle system, cue, and the music bed is
// produced with the asset tools during this build and committed under
// `assets/`; nothing here invokes a tool, and neither `npm ci` nor
// `npm run build` does. The URLs come from Vite's import glob, which resolves
// them against the page rather than the origin root, so the built site runs
// unchanged from the root of a static host and from a sub-path alike — a
// root-absolute `/assets/...` would fail under a sub-path. The three particle
// systems are small JSON documents, so they are imported as data and land
// inside the bundle: the running game asks the network for nothing at all
// beyond its own images and sounds.
//
// A file that is absent resolves to `null` and a load that fails leaves the
// game running: the cue is simply silent, the renderer falls back to what it
// draws in code, and an effect that has no system plays nothing, so a missing
// file costs the game its polish rather than its playability
// (specs/assets.md).

import {
  APERTURE_FRAMES,
  APERTURE_SHEETS,
  CUE_PATHS,
  FILAMENT_SPRITE_PATHS,
  FIXTURE_MOUNT_PATH,
  GRIPPER_PATHS,
  HUB_PATHS,
  INSTRUCTION_GLYPH_PATHS,
  MOTE_SPRITE_PATHS,
  PARTICLE_PATHS,
  SIGIL_GLYPH_PATHS,
  WHEEL_HUB_PATH,
  type Cue,
  type ParticleSystemName,
} from "./constants";

/** Every produced sound the build committed, by its path under `assets/`. */
const AUDIO_URLS = import.meta.glob<string>("../assets/audio/*.wav", {
  eager: true,
  query: "?url",
  import: "default",
});

/** Every produced sprite and sheet frame, by its path under `assets/`. */
const SPRITE_URLS = import.meta.glob<string>("../assets/sprites/**/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

/**
 * The three produced particle systems, as parsed data rather than as URLs:
 * each is a small `system.json`, so bundling the document itself spares the
 * built site a fetch it would otherwise make of its own directory.
 */
const PARTICLE_SYSTEMS = import.meta.glob<unknown>(
  "../assets/particles/*.json",
  { eager: true, import: "default" },
);

/**
 * The bundled URL of a produced file, named by its path relative to `assets/`,
 * or `null` when this build committed no such file.
 */
export function resolveAsset(
  urls: Record<string, string>,
  path: string,
): string | null {
  const suffix = `/${path}`;
  for (const [key, url] of Object.entries(urls)) {
    if (key.endsWith(suffix)) return url;
  }
  return null;
}

/** Each cue's produced sound, by name; `null` for one this build has not made. */
export function cueUrls(): Record<Cue, string | null> {
  const urls = {} as Record<Cue, string | null>;
  for (const [cue, path] of Object.entries(CUE_PATHS)) {
    urls[cue as Cue] = resolveAsset(AUDIO_URLS, path);
  }
  return urls;
}

/** The bundled URL of one produced sprite, or `null` when it is absent. */
export function spriteUrl(path: string): string | null {
  return resolveAsset(SPRITE_URLS, path);
}

/** One frame of an aperture sheet, by its path under `assets/`. */
export function aperturePath(sheet: "rise" | "set", frame: number): string {
  return `${APERTURE_SHEETS[sheet]}/${frame}.png`;
}

/**
 * Every sprite path the renderer draws, so the loader decodes the whole set
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
 * One produced particle system, as the document `particle-2d` wrote, or `null`
 * when this build committed no such file.
 */
export function particleSystem(name: ParticleSystemName): unknown {
  const suffix = `/${PARTICLE_PATHS[name]}`;
  for (const [key, system] of Object.entries(PARTICLE_SYSTEMS)) {
    if (key.endsWith(suffix)) return system;
  }
  return null;
}
