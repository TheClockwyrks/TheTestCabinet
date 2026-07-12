// Valence — load the PRODUCED assets (specs/assets.md).
//
// Every sprite, sprite-sheet frame, particle system, and sound the game plays was
// produced during the build with the on-PATH tools and committed under assets/. They
// are loaded here through Vite's import globs, so every URL resolves page-relative
// under any base path (vite.config sets base "./"), exactly as specs/assets.md
// requires — never a root-absolute "/assets/…" URL.
//
// The tower and matter roster is keyed by ROLE; several roles share a produced sprite
// FAMILY (a Cleaver reads as the produced cleave/shear head, a Reactor as the produced
// reactor/fission rotor), and the two energy generalists (Emitter, Beam) reuse a family
// tinted to their accent. The damage-type bursts and cues map onto the produced systems.
// This mapping is the single place the produced files meet the redesigned roster.

import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type { FxKind, Cue } from "./types";
import { DMG_COLOR, type TowerKind } from "./constants";

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

// The produced sprite family a tower ROLE draws from (specs/assets.md). Emitter and Beam
// reuse the ionizer/cleave heads, tinted to their accent in render.
const TOWER_FAMILY: Record<TowerKind, "ionizer" | "shear" | "fission" | "catalyst" | "moderator"> = {
  emitter: "ionizer",
  ionizer: "ionizer",
  cleaver: "shear",
  reactor: "fission",
  beam: "ionizer",
  catalyst: "catalyst",
  moderator: "moderator",
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
  tinted(name: string, color: string): HTMLImageElement; // a colour-tinted variant, cached
  has(name: string): boolean;
  electron: HTMLImageElement[];
  boss: HTMLImageElement[];
  towerFire: Record<TowerKind, HTMLImageElement[]>;
  projColor: Record<TowerKind, string>; // damage-type accent for a shot
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

  // A small cache of colour-tinted sprite variants (keeps some of the produced shading
  // while pushing the head toward the role's accent). Used for the two reused families.
  const tintCache = new Map<string, HTMLImageElement>();
  const tinted = (name: string, color: string): HTMLImageElement => {
    const key = `${name}|${color}`;
    const hit = tintCache.get(key);
    if (hit) return hit;
    const src = sprite(name);
    const c = document.createElement("canvas");
    c.width = src.naturalWidth || 32;
    c.height = src.naturalHeight || 32;
    const cx = c.getContext("2d")!;
    cx.imageSmoothingEnabled = false;
    cx.drawImage(src, 0, 0);
    cx.globalCompositeOperation = "source-atop";
    cx.globalAlpha = 0.55;
    cx.fillStyle = color;
    cx.fillRect(0, 0, c.width, c.height);
    const out = new Image();
    out.src = c.toDataURL();
    tintCache.set(key, out);
    return out;
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

  const fireByFamily: Record<string, HTMLImageElement[]> = {
    ionizer: framesFor("towers/ionizer_fire", 4),
    shear: framesFor("towers/shear_fire", 4),
    fission: framesFor("towers/fission_fire", 4),
  };
  const towerFire = {} as Record<TowerKind, HTMLImageElement[]>;
  const projColor = {} as Record<TowerKind, string>;
  for (const kind of Object.keys(TOWER_FAMILY) as TowerKind[]) {
    towerFire[kind] = fireByFamily[TOWER_FAMILY[kind]] ?? [];
    projColor[kind] =
      kind === "cleaver" ? DMG_COLOR.kinetic : kind === "reactor" ? DMG_COLOR.nuclear : DMG_COLOR.energy;
  }

  return {
    sprite,
    tinted,
    has: (name: string) => imgs.has(name),
    electron: framesFor("matter/electrons", 8),
    boss: framesFor("matter/boss_anim", 8),
    towerFire,
    projColor,
    fx,
    audioUrl,
  };
}

// The produced base-sprite name for a tower role and level (1..3), via its family.
export function towerSprite(kind: TowerKind, level: number): string {
  return `towers/${TOWER_FAMILY[kind]}_${Math.max(1, Math.min(3, level))}`;
}

// The produced projectile sprite for a tower role, via its family.
export function projSprite(kind: TowerKind): string {
  const fam = TOWER_FAMILY[kind];
  const base = fam === "shear" ? "shear" : fam === "fission" ? "fission" : "ionizer";
  return `towers/proj_${base}`;
}

// Roles that reuse a family tinted to their own accent (Emitter, Beam).
export function towerTint(kind: TowerKind): string | null {
  if (kind === "emitter") return "#8fb9ff";
  if (kind === "beam") return "#c9f24a";
  return null;
}
