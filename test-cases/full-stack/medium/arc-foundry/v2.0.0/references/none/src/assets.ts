// Arc Foundry — loading the produced assets (specs/assets.md).
//
// Every sprite, animation frame, particle system, and sound the game plays was produced
// with the asset tools and committed under `assets/`. This module is the one place those
// files' paths meet the game's roster, so the layout `specs/assets.md` fixes is stated
// here once and nowhere else.
//
// The files are pulled in through Vite's import globs, so every URL the built site
// requests resolves against the page rather than against the origin root: the bundler's
// base is relative and no request carries a leading `/`. That is what lets the same
// `dist/` run at the root of a static host or mounted under a sub-path of one. The build
// is self-contained — it bundles these committed files and generates nothing.

import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import { COMBO_ORDER, COMPONENT_ORDER, CUES } from "./constants";
import type { ComboType, ComponentType, Cue, FxKind, Tier } from "./types";

// The seven idle cycles: the six roster types plus the Overload Dynamo of the finale.
export const LOAD_SPRITE_TYPES = [
  "mote",
  "spark",
  "slug",
  "cluster",
  "filament",
  "dynamo",
  "overload",
] as const;

export type LoadSprite = (typeof LOAD_SPRITE_TYPES)[number];

// Every animation cycle is four frames, `0.png` through `3.png` (specs/assets.md).
export const CYCLE_FRAMES = 4;

const pngUrls = import.meta.glob<string>("../assets/**/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});
const fxJson = import.meta.glob<ParticleSystem>("../assets/fx/*.json", {
  eager: true,
  import: "default",
});
const wavUrls = import.meta.glob<string>("../assets/audio/*.wav", {
  eager: true,
  query: "?url",
  import: "default",
});

function keyOf(globPath: string, ext: string): string {
  return globPath.replace("../assets/", "").replace(ext, "");
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Arc Foundry: failed to load ${url}`));
    img.src = url;
  });
}

// ---- The produced layout, path by path (specs/assets.md) ----------------------

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
/** A base component's rotating head, one per type per quality tier. */
export function componentHeadSprite(type: ComponentType, tier: Tier): string {
  return `components/${type}/head-${tier}`;
}
/** The fixed mount a combination tower's head turns on. */
export function comboBaseSprite(combo: ComboType): string {
  return `combos/${combo}/base`;
}
/** A combination tower's rotating head. A tower has no tier variants. */
export function comboHeadSprite(combo: ComboType): string {
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
/** A Load type's still sprite: frame `0` of its idle cycle. */
export function loadStill(type: LoadSprite): string {
  return `load/${type}/0`;
}

// Which produced particle system plays for each event. The twelve names are the
// `specs/assets.md` effect names, and each file is `assets/fx/<effect>.json`.
const FX_NAMES: readonly FxKind[] = [
  "build",
  "combine",
  "bolt",
  "chain",
  "spray",
  "ring",
  "impact",
  "death",
  "leak",
  "slow",
  "burn",
  "aura",
];

// Which produced `.wav` plays for each cue. The file is `assets/audio/<cue>.wav`, named by
// the cue itself (specs/assets.md), so the mapping is the identity.
const CUE_NAMES: readonly Cue[] = Object.values(CUES);

export interface Assets {
  sprite(name: string): HTMLImageElement;
  has(name: string): boolean;
  componentBase(type: ComponentType): HTMLImageElement | undefined;
  componentHead(type: ComponentType, tier: Tier): HTMLImageElement | undefined;
  /** A base type's four-frame firing cycle, played once per shot. */
  componentFire(type: ComponentType): HTMLImageElement[];
  comboBase(combo: ComboType): HTMLImageElement | undefined;
  comboHead(combo: ComboType): HTMLImageElement | undefined;
  /** A tower's four-frame firing cycle, played once per shot. */
  comboFire(combo: ComboType): HTMLImageElement[];
  blocker: HTMLImageElement | undefined;
  projectile(type: ComponentType): HTMLImageElement | undefined;
  /** Each Load type's four-frame idle cycle, looped while it is on the yard. */
  loadFrames: Record<LoadSprite, HTMLImageElement[]>;
  /** The press stamping cycle, played when a rock is placed. */
  pressFrames: HTMLImageElement[];
  fx: Record<FxKind, ParticleSystem | undefined>;
  audioUrl: Record<Cue, string>;
  /** Every produced file whose load failed, so a missing asset is visible rather than silent. */
  failures: string[];
}

export async function loadAssets(): Promise<Assets> {
  const imgs = new Map<string, HTMLImageElement>();
  const failures: string[] = [];
  await Promise.all(
    Object.entries(pngUrls).map(async ([globPath, url]) => {
      const key = keyOf(globPath, ".png");
      try {
        imgs.set(key, await loadImage(url));
      } catch {
        failures.push(key);
      }
    }),
  );

  const frames = (prefix: string): HTMLImageElement[] => {
    const out: HTMLImageElement[] = [];
    for (let i = 0; i < CYCLE_FRAMES; i++) {
      const img = imgs.get(`${prefix}/${i}`);
      if (img) out.push(img);
    }
    return out;
  };

  const sprite = (name: string): HTMLImageElement => {
    const img = imgs.get(name);
    if (!img) throw new Error(`Arc Foundry: missing sprite "${name}"`);
    return img;
  };

  const rawFx: Record<string, ParticleSystem> = {};
  for (const [globPath, sys] of Object.entries(fxJson)) {
    rawFx[keyOf(globPath, ".json").replace("fx/", "")] = sys;
  }
  const fx = {} as Record<FxKind, ParticleSystem | undefined>;
  for (const k of FX_NAMES) {
    fx[k] = rawFx[k];
    if (!rawFx[k]) failures.push(`fx/${k}.json`);
  }

  const rawWav: Record<string, string> = {};
  for (const [globPath, url] of Object.entries(wavUrls)) {
    rawWav[keyOf(globPath, ".wav").replace("audio/", "")] = url;
  }
  const audioUrl = {} as Record<Cue, string>;
  for (const k of CUE_NAMES) {
    audioUrl[k] = rawWav[k] ?? "";
    if (!rawWav[k]) failures.push(`audio/${k}.wav`);
  }

  const loadFrames = {} as Record<LoadSprite, HTMLImageElement[]>;
  for (const t of LOAD_SPRITE_TYPES) loadFrames[t] = frames(`load/${t}`);

  const componentFire = {} as Record<ComponentType, HTMLImageElement[]>;
  for (const c of COMPONENT_ORDER) componentFire[c] = frames(`components/${c}/fire`);

  const comboFire = {} as Record<ComboType, HTMLImageElement[]>;
  for (const c of COMBO_ORDER) comboFire[c] = frames(`combos/${c}/fire`);

  return {
    sprite,
    has: (name: string) => imgs.has(name),
    componentBase: (type) => imgs.get(componentBaseSprite(type)),
    componentHead: (type, tier) => imgs.get(componentHeadSprite(type, tier)),
    componentFire: (type) => componentFire[type],
    comboBase: (combo) => imgs.get(comboBaseSprite(combo)),
    comboHead: (combo) => imgs.get(comboHeadSprite(combo)),
    comboFire: (combo) => comboFire[combo],
    blocker: imgs.get(BLOCKER_SPRITE),
    projectile: (type) => imgs.get(projectileSprite(type)),
    loadFrames,
    pressFrames: frames("press"),
    fx,
    audioUrl,
    failures,
  };
}
