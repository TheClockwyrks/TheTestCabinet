// Arc Foundry — the produced files, loaded once (specs/assets.md).
//
// Every sprite, animation frame, particle system, and sound the game plays was produced
// with the asset tools and committed under `assets/`. This module is the one place
// those paths meet the game's roster, so the layout `specs/assets.md` fixes is stated
// here and nowhere else, and it is the one place the engine's asset loader is called.
//
// LOADING IS THE ENGINE'S. `InitApi.assets` resolves every path under the one root,
// fetches it, and decodes it, and it announces each attempt as an engine event, so a
// caller watching `asset:failed` sees exactly which file did not arrive. The build asks
// for every file once, inside `initialize`, and keeps the results in its state: by the
// time a frame runs, what arrived is a plain value and nothing loads again.
//
// A FILE THAT DOES NOT ARRIVE IS NOT FATAL. Every load is caught, so one missing sprite
// costs that sprite and nothing else — the renderer draws the piece it stands for from
// its own geometry instead, and the game stays playable. The names that failed are kept
// so they are visible rather than silent.

import {
  COMBO_IDS,
  COMPONENT_TYPES,
  CUES,
  CYCLE_FRAMES,
  EFFECTS,
  LOAD_TYPES,
  MAX_QUALITY,
  OVERLOAD_TYPE,
  type ComboId,
  type ComponentType,
  type CueName,
  type EffectName,
} from "./constants";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type { InitApi } from "@test-cabinet/structured-2d";

/** The seven idle cycles: the six roster types and the finale's Overload Dynamo. */
export const LOAD_SPRITE_TYPES: readonly string[] = [
  ...LOAD_TYPES,
  OVERLOAD_TYPE,
];

// ---- The layout, path by path (specs/assets.md) --------------------------

export const YARD_SUBSTRATE = "yard/substrate";
export const YARD_ENTRY = "yard/entry";
export const YARD_COLLECTOR = "yard/collector";
export const YARD_WAYPOINT = "yard/waypoint";
export const YARD_HOUSING = "yard/housing";
export const BLOCKER_SPRITE = "blocker";
export const CHARGE_ICON = "icons/charge";
export const INTEGRITY_ICON = "icons/integrity";

/** The fixed mount a base component's head turns on. */
export function componentBaseSprite(type: ComponentType): string {
  return `components/${type}/base`;
}

/** A base component's rotating head, one per type per quality rung. */
export function componentHeadSprite(
  type: ComponentType,
  quality: number,
): string {
  return `components/${type}/head-${quality}`;
}

/** The fixed mount a combination tower's head turns on. */
export function comboBaseSprite(combo: ComboId): string {
  return `combos/${combo}/base`;
}

/** A combination tower's rotating head. A tower has no quality variants. */
export function comboHeadSprite(combo: ComboId): string {
  return `combos/${combo}/head`;
}

/** The travelling shot, one per firing base type. */
export function projectileSprite(type: ComponentType): string {
  return `projectiles/${type}`;
}

/** The panel's glyph for a base component type. */
export function typeIcon(type: ComponentType): string {
  return `icons/type-${type}`;
}

/** A Load type's still sprite: frame `0` of its own idle cycle. */
export function loadStill(type: string): string {
  return `load/${type}/0`;
}

/** An image as the renderer draws it. */
export type Sprite = ImageBitmap;

/**
 * Everything produced, ready to draw and to play.
 *
 * Every accessor is a lookup, never a load: the whole set is in hand before the first
 * frame, and a name that did not arrive reads as `null` rather than throwing, so the
 * renderer chooses its fallback rather than the frame failing.
 */
export interface Assets {
  /** One sprite by its path under the asset root, without the extension. */
  sprite(name: string): Sprite | null;
  has(name: string): boolean;
  componentBase(type: ComponentType): Sprite | null;
  componentHead(type: ComponentType, quality: number): Sprite | null;
  /** A base type's firing cycle, played once per shot. */
  componentFire(type: ComponentType): Sprite[];
  comboBase(combo: ComboId): Sprite | null;
  comboHead(combo: ComboId): Sprite | null;
  /** A tower's firing cycle, played once per shot. */
  comboFire(combo: ComboId): Sprite[];
  blocker(): Sprite | null;
  projectile(type: ComponentType): Sprite | null;
  /** A Load type's idle cycle, looped while it is on the yard. */
  loadFrames(type: string): Sprite[];
  /** The press's stamping cycle, played as a rock lands. */
  pressFrames(): Sprite[];
  /** The produced particle system an effect plays, or `null` if it did not arrive. */
  effect(kind: EffectName): ParticleSystem | null;
  /** Every produced file whose load failed, so a missing asset is visible. */
  failures(): string[];
}

/** Every sprite path the game asks for, derived from the roster. */
function spritePaths(): string[] {
  const paths = [
    YARD_SUBSTRATE,
    YARD_ENTRY,
    YARD_COLLECTOR,
    YARD_WAYPOINT,
    YARD_HOUSING,
    BLOCKER_SPRITE,
    CHARGE_ICON,
    INTEGRITY_ICON,
  ];
  for (let i = 0; i < CYCLE_FRAMES; i++) paths.push(`press/${i}`);
  for (const type of COMPONENT_TYPES) {
    paths.push(componentBaseSprite(type), typeIcon(type));
    for (let q = 1; q <= MAX_QUALITY; q++)
      paths.push(componentHeadSprite(type, q));
    for (let i = 0; i < CYCLE_FRAMES; i++)
      paths.push(`components/${type}/fire/${i}`);
    // The Regulator never fires, so it launches no shot and has no projectile.
    if (type !== "regulator") paths.push(projectileSprite(type));
  }
  for (const combo of COMBO_IDS) {
    paths.push(comboBaseSprite(combo), comboHeadSprite(combo));
    for (let i = 0; i < CYCLE_FRAMES; i++)
      paths.push(`combos/${combo}/fire/${i}`);
  }
  for (const type of LOAD_SPRITE_TYPES) {
    for (let i = 0; i < CYCLE_FRAMES; i++) paths.push(`load/${type}/${i}`);
  }
  return paths;
}

/**
 * Load every produced file, and return them as one value the state carries.
 *
 * The cues are declared before they are backed by their produced clips: a synthesized
 * shape under each of the twelve names first, so playing a cue never names something
 * that was never declared, then the produced `.wav` over it, which replaces what the
 * name plays. A clip that does not arrive leaves its name declared, so the game is
 * audible either way and the failure is reported rather than silently mute.
 */
export async function loadAssets(
  api: Pick<InitApi, "assets" | "audio">,
  cueSpecs: Readonly<
    Record<CueName, Parameters<InitApi["audio"]["define"]>[1]>
  >,
): Promise<Assets> {
  const images = new Map<string, Sprite>();
  const systems = new Map<string, ParticleSystem>();
  const failures: string[] = [];

  await Promise.all(
    spritePaths().map(async (path) => {
      try {
        images.set(path, await api.assets.loadImage(`${path}.png`));
      } catch {
        failures.push(`${path}.png`);
      }
    }),
  );

  await Promise.all(
    EFFECTS.map(async (effect) => {
      try {
        const blob = await api.assets.load(`fx/${effect}.json`);
        systems.set(effect, JSON.parse(await blob.text()) as ParticleSystem);
      } catch {
        failures.push(`fx/${effect}.json`);
      }
    }),
  );

  for (const cue of Object.values(CUES)) api.audio.define(cue, cueSpecs[cue]);
  await Promise.all(
    Object.values(CUES).map(async (cue) => {
      try {
        await api.audio.load(cue, `audio/${cue}.wav`);
      } catch {
        failures.push(`audio/${cue}.wav`);
      }
    }),
  );

  const frames = (prefix: string): Sprite[] => {
    const out: Sprite[] = [];
    for (let i = 0; i < CYCLE_FRAMES; i++) {
      const img = images.get(`${prefix}/${i}`);
      if (img) out.push(img);
    }
    return out;
  };

  const componentFire = new Map<ComponentType, Sprite[]>();
  for (const type of COMPONENT_TYPES) {
    componentFire.set(type, frames(`components/${type}/fire`));
  }
  const comboFire = new Map<ComboId, Sprite[]>();
  for (const combo of COMBO_IDS)
    comboFire.set(combo, frames(`combos/${combo}/fire`));
  const loadFrames = new Map<string, Sprite[]>();
  for (const type of LOAD_SPRITE_TYPES)
    loadFrames.set(type, frames(`load/${type}`));
  const press = frames("press");

  return {
    sprite: (name) => images.get(name) ?? null,
    has: (name) => images.has(name),
    componentBase: (type) => images.get(componentBaseSprite(type)) ?? null,
    componentHead: (type, quality) =>
      images.get(componentHeadSprite(type, quality)) ?? null,
    componentFire: (type) => componentFire.get(type) ?? [],
    comboBase: (combo) => images.get(comboBaseSprite(combo)) ?? null,
    comboHead: (combo) => images.get(comboHeadSprite(combo)) ?? null,
    comboFire: (combo) => comboFire.get(combo) ?? [],
    blocker: () => images.get(BLOCKER_SPRITE) ?? null,
    projectile: (type) => images.get(projectileSprite(type)) ?? null,
    loadFrames: (type) => loadFrames.get(type) ?? [],
    pressFrames: () => press,
    effect: (kind) => systems.get(kind) ?? null,
    failures: () => [...failures],
  };
}

/** An empty set, for a world stood up without any produced file. */
export function noAssets(): Assets {
  return {
    sprite: () => null,
    has: () => false,
    componentBase: () => null,
    componentHead: () => null,
    componentFire: () => [],
    comboBase: () => null,
    comboHead: () => null,
    comboFire: () => [],
    blocker: () => null,
    projectile: () => null,
    loadFrames: () => [],
    pressFrames: () => [],
    effect: () => null,
    failures: () => [],
  };
}
