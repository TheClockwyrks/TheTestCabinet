// Valence — load the PRODUCED assets (specs/assets.md).
//
// Every sprite, sprite-sheet frame, particle system, and sound the game plays was
// produced during the build with the on-PATH tools and committed under assets/. They
// are loaded here through Vite's import globs, so every URL resolves page-relative
// under any base path (vite.config sets base "./"), exactly as specs/assets.md
// requires — never a root-absolute "/assets/…" URL.
//
// Each tower ROLE has its own produced head/fire sprites, except that a Cleaver reads as
// the produced kinetic "shear" head and a Reactor as the produced nuclear "fission" rotor
// (true re-roles — same visual). The three projectiles are keyed by DAMAGE TYPE (the
// produced energy/kinetic/nuclear shots), and the damage/decomposition bursts and cues
// map onto the produced systems. This mapping is the one place the produced files meet
// the redesigned roster.

import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type { FxKind, Cue } from "./types";
import type { DamageType, TowerKind } from "./constants";

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
    img.onerror = () => reject(new Error(`Valence: failed to load ${url}`));
    img.src = url;
  });
}

// The produced sprite family a tower ROLE draws from. Emitter and Beam have their own
// produced heads and fire cycles; Cleaver/Reactor re-use the kinetic/nuclear heads.
const SPRITE_FAMILY: Record<TowerKind, string> = {
  emitter: "emitter",
  ionizer: "ionizer",
  cleaver: "shear",
  reactor: "fission",
  beam: "beam",
  catalyst: "catalyst",
  moderator: "moderator",
};

// The produced projectile sprite for each damage type (specs/matter.md, specs/towers.md).
const PROJ_BY_TYPE: Record<DamageType, string> = {
  energy: "towers/proj_ionizer",
  kinetic: "towers/proj_shear",
  nuclear: "towers/proj_fission",
};

// Which produced particle system stands in for each decomposition/damage event.
const FX_SOURCE: Record<FxKind, string> = {
  energy: "ionize",
  kinetic: "bondsnap",
  nuclear: "fission",
  bondsnap: "bondsnap",
  split: "fission",
  neutralize: "neutralize",
  muzzle: "muzzle",
  leak: "leak",
  reveal: "neutralize",
};

// Which produced .wav stands in for each sound cue.
const CUE_SOURCE: Record<Cue, string> = {
  shot: "shot",
  kinetic: "snap",
  nuclear: "fission",
  snap: "snap",
  neutralize: "neutralize",
  build: "build",
  alarm: "alarm",
  reveal: "build",
};

export interface Assets {
  sprite(name: string): HTMLImageElement;
  has(name: string): boolean;
  electron: HTMLImageElement[];
  boss: HTMLImageElement[];
  towerFire: Record<TowerKind, HTMLImageElement[]>;
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
      const img = imgs.get(`${prefix}/${i}`);
      if (img) out.push(img);
    }
    return out;
  };

  const sprite = (name: string): HTMLImageElement => {
    const img = imgs.get(name);
    if (!img) throw new Error(`Valence: missing sprite "${name}"`);
    return img;
  };

  const rawFx: Record<string, ParticleSystem> = {};
  for (const [globPath, sys] of Object.entries(fxJson)) rawFx[keyOf(globPath, ".system.json").replace("fx/", "")] = sys;
  const fx = {} as Record<FxKind, ParticleSystem | undefined>;
  for (const k of Object.keys(FX_SOURCE) as FxKind[]) fx[k] = rawFx[FX_SOURCE[k]];

  const rawWav: Record<string, string> = {};
  for (const [globPath, url] of Object.entries(wavUrls)) rawWav[keyOf(globPath, ".wav").replace("audio/", "")] = url;
  const audioUrl = {} as Record<Cue | "music", string>;
  for (const k of Object.keys(CUE_SOURCE) as Cue[]) audioUrl[k] = rawWav[CUE_SOURCE[k]] ?? rawWav.build ?? "";
  audioUrl.music = rawWav.music ?? "";

  const towerFire = {} as Record<TowerKind, HTMLImageElement[]>;
  for (const kind of Object.keys(SPRITE_FAMILY) as TowerKind[]) {
    towerFire[kind] = framesFor(`towers/${SPRITE_FAMILY[kind]}_fire`, 4);
  }

  return {
    sprite,
    has: (name: string) => imgs.has(name),
    electron: framesFor("matter/electrons", 8),
    boss: framesFor("matter/boss_anim", 8),
    towerFire,
    fx,
    audioUrl,
  };
}

// The produced base-sprite name for a tower role and level (1..3), via its family.
export function towerSprite(kind: TowerKind, level: number): string {
  return `towers/${SPRITE_FAMILY[kind]}_${Math.max(1, Math.min(3, level))}`;
}

// The produced projectile sprite for a damage type (energy / kinetic / nuclear).
export function projSprite(damageType: DamageType): string {
  return PROJ_BY_TYPE[damageType];
}
