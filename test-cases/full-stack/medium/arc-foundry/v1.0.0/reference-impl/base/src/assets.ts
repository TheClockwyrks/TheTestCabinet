// Arc Foundry — load the PRODUCED assets (specs/assets.md).
//
// Every sprite, sprite-sheet frame, particle system, and sound the game plays was produced
// during the run with the six on-PATH tools and committed under assets/. They are loaded
// here through Vite's import globs, so every URL resolves PAGE-RELATIVE under any base
// path (vite.config sets base "./"), exactly as specs/assets.md requires — never a
// root-absolute "/assets/…" URL. This module is the one place the produced files' names
// meet the game's roster; the layout below is the asset-production contract.
//
// Produced layout (specs/assets.md):
//   assets/board/            substrate, entry, collector, pylon, housing
//   assets/components/<type>/   base, head_<tier> (1..5), fire_<n> (firing cycle)
//   assets/components/blocker/  rock (the inert blocker lump)
//   assets/projectiles/      capacitor, emitter, discharge (single-bolt shots)
//   assets/load/<type>/      idle_<n> (charge cycle) + frame 0 as the static read
//   assets/fx/press/         press-stamp cycle frames
//   assets/icons/            charge, integrity, one per component type
//   assets/fx/*.system.json  the produced electrical particle systems
//   assets/audio/*.wav       the produced sfx + music

import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import { COMPONENT_ORDER, LOAD_ORDER } from "./constants";
import type { ComponentType, Cue, FxKind, LoadType, Tier } from "./types";

const pngUrls = import.meta.glob<string>("../assets/**/*.png", { eager: true, query: "?url", import: "default" });
const fxJson = import.meta.glob<ParticleSystem>("../assets/fx/*.system.json", { eager: true, import: "default" });
const wavUrls = import.meta.glob<string>("../assets/audio/*.wav", { eager: true, query: "?url", import: "default" });

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

// ---- Produced-file name helpers (the load-path contract) ------------------------

// A firing component's rotatable head sprite for a type at a quality tier (1..5).
export function componentHeadSprite(type: ComponentType, tier: Tier): string {
  return `components/${type}/head_${tier}`;
}
// A component's non-rotatable base/mount (drawn under the head; does not rotate).
export function componentBaseSprite(type: ComponentType): string {
  return `components/${type}/base`;
}
// The inert blocker rock — the lump an unkept rock hardens into (specs/build.md).
export const BLOCKER_SPRITE = "components/blocker/rock";
// The travelling projectile sprite for a single-bolt component (Coil/Arc-Node are VFX).
export function projSprite(type: ComponentType): string {
  return `projectiles/${type}`;
}

// Which produced particle system plays for each electrical event (1:1 by name).
const FX_SOURCE: Record<FxKind, string> = {
  buildspark: "buildspark",
  combine: "combine",
  arcbolt: "arcbolt",
  chain: "chain",
  spray: "spray",
  ring: "ring",
  impact: "impact",
  death: "death",
  leak: "leak",
  muzzle: "muzzle",
};

// Which produced .wav plays for each sound cue (1:1 by name).
const CUE_SOURCE: Record<Cue, string> = {
  stamp: "stamp",
  zap: "zap",
  chain: "chain",
  discharge: "discharge",
  combine: "combine",
  kill: "kill",
  leak: "leak",
  settle: "settle",
};

export interface Assets {
  sprite(name: string): HTMLImageElement;
  has(name: string): boolean;
  componentBase(type: ComponentType): HTMLImageElement | undefined;
  componentHead(type: ComponentType, tier: Tier): HTMLImageElement | undefined;
  componentFire(type: ComponentType): HTMLImageElement[]; // firing-cycle frames
  blocker: HTMLImageElement | undefined;
  projectile(type: ComponentType): HTMLImageElement | undefined;
  loadFrames: Record<LoadType, HTMLImageElement[]>; // per-type charge cycle
  pressFrames: HTMLImageElement[]; // the scrap-press stamping cycle
  fx: Record<FxKind, ParticleSystem | undefined>;
  audioUrl: Record<Cue | "music", string>;
}

export async function loadAssets(): Promise<Assets> {
  const imgs = new Map<string, HTMLImageElement>();
  await Promise.all(
    Object.entries(pngUrls).map(async ([globPath, url]) => {
      imgs.set(keyOf(globPath, ".png"), await loadImage(url));
    }),
  );

  const framesFor = (prefix: string, count: number): HTMLImageElement[] => {
    const out: HTMLImageElement[] = [];
    for (let i = 0; i < count; i++) {
      const img = imgs.get(`${prefix}/${i}`) ?? imgs.get(`${prefix}_${i}`);
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
  for (const [globPath, sys] of Object.entries(fxJson)) rawFx[keyOf(globPath, ".system.json").replace("fx/", "")] = sys;
  const fx = {} as Record<FxKind, ParticleSystem | undefined>;
  for (const k of Object.keys(FX_SOURCE) as FxKind[]) fx[k] = rawFx[FX_SOURCE[k]];

  const rawWav: Record<string, string> = {};
  for (const [globPath, url] of Object.entries(wavUrls)) rawWav[keyOf(globPath, ".wav").replace("audio/", "")] = url;
  const audioUrl = {} as Record<Cue | "music", string>;
  for (const k of Object.keys(CUE_SOURCE) as Cue[]) audioUrl[k] = rawWav[CUE_SOURCE[k]] ?? "";
  audioUrl.music = rawWav.music ?? "";

  const loadFrames = {} as Record<LoadType, HTMLImageElement[]>;
  for (const t of LOAD_ORDER) loadFrames[t] = framesFor(`load/${t}/idle`, 8);

  const componentFireCache = {} as Record<ComponentType, HTMLImageElement[]>;
  for (const c of COMPONENT_ORDER) componentFireCache[c] = framesFor(`components/${c}/fire`, 6);

  return {
    sprite,
    has: (name: string) => imgs.has(name),
    componentBase: (type) => imgs.get(componentBaseSprite(type)),
    componentHead: (type, tier) => imgs.get(componentHeadSprite(type, tier)),
    componentFire: (type) => componentFireCache[type],
    blocker: imgs.get(BLOCKER_SPRITE),
    projectile: (type) => imgs.get(projSprite(type)),
    loadFrames,
    pressFrames: framesFor("fx/press/stamp", 8),
    fx,
    audioUrl,
  };
}
