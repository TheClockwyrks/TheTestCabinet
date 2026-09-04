// Orrery — loading the produced art (specs/assets.md, ASSET-LAYOUT.md).
//
// Every sprite, sheet frame, and particle system the game shows was produced
// with the asset tools during this build and committed under `assets/`; nothing
// here invokes a tool, and neither `npm ci` nor `npm run build` does. The
// ENGINE'S asset loader resolves every path under its `assets/` root, relative
// to the page the build is served from, so the built site runs from the root of
// a static host and from a sub-path alike.
//
// A load that fails leaves the game running. Each image resolves to `null`, the
// drawing code falls back to what it draws in code, and a missing particle
// system simply plays nothing, so a missing file costs the game its polish
// rather than its playability.
//
// The loaded set is held here, in the module the drawing components import, as
// the engine's asset documentation recommends: the instance's `initialize`
// awaits `loadAssets` before the one level opens, so a component constructed
// for that level reads each image as a plain value.

import type { InitApi } from "@test-cabinet/structured-2d";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
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
import { PARTICLE_NAMES, type ParticleSystemName } from "./figures";

/** What the drawing code asks of the loaded sprites. */
export interface Sprites {
  /** The decoded sprite at a path under `assets/`, or `null` when absent. */
  get(path: string): CanvasImageSource | null;
}

/** A store holding nothing, which a failed load and a headless test both see. */
export const NO_SPRITES: Sprites = { get: () => null };

/** One frame of an aperture sheet, by its path under `assets/`. */
export function aperturePath(sheet: "rise" | "set", frame: number): string {
  return `${APERTURE_SHEETS[sheet]}/${frame}.png`;
}

/**
 * Every sprite path the drawing code asks for, so the loader decodes the whole
 * set once before the first frame (specs/assets.md).
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

/** The decoded sprites, and the parsed particle systems. */
interface LoadedAssets {
  readonly images: Map<string, CanvasImageSource>;
  readonly systems: Map<ParticleSystemName, ParticleSystem>;
}

let loaded: LoadedAssets = { images: new Map(), systems: new Map() };

/**
 * Install a loaded set for the drawing code to read. `loadAssets` calls this
 * once the produced files have resolved; the build's own tests call it to stand
 * the drawing up over stand-in art, since nothing in a Node process can decode
 * a PNG.
 */
export function installAssets(
  images: Map<string, CanvasImageSource>,
  systems: Map<ParticleSystemName, ParticleSystem>,
): void {
  loaded = { images, systems };
}

/** The loaded sprites. Empty until `loadAssets` resolves. */
export function orrerySprites(): Sprites {
  const { images } = loaded;
  return { get: (path) => images.get(path) ?? null };
}

/** The produced particle system of that name, or `null` where it is absent. */
export function particleSystemOf(
  name: ParticleSystemName,
): ParticleSystem | null {
  return loaded.systems.get(name) ?? null;
}

/** Whether a loaded document is a particle system the player can play. */
function isSystem(value: unknown): value is ParticleSystem {
  if (typeof value !== "object" || value === null) return false;
  const system = value as Partial<ParticleSystem>;
  return (
    typeof system.durationMs === "number" &&
    typeof system.field === "object" &&
    Array.isArray(system.emitters)
  );
}

/**
 * Load every produced file the game draws, tolerating each failure on its own,
 * and install the result for the drawing components to read.
 */
export async function loadAssets(api: Pick<InitApi, "assets">): Promise<void> {
  const images = new Map<string, CanvasImageSource>();
  const systems = new Map<ParticleSystemName, ParticleSystem>();
  const jobs: Promise<void>[] = [];

  for (const path of spritePaths()) {
    jobs.push(
      api.assets
        .loadImage(path)
        .then((image) => {
          images.set(path, image);
        })
        .catch(() => undefined),
    );
  }
  for (const name of PARTICLE_NAMES) {
    jobs.push(
      api.assets
        .load(PARTICLE_PATHS[name])
        .then(async (blob) => JSON.parse(await blob.text()) as unknown)
        .then((document) => {
          if (isSystem(document)) systems.set(name, document);
        })
        .catch(() => undefined),
    );
  }

  await Promise.all(jobs);
  installAssets(images, systems);
}
