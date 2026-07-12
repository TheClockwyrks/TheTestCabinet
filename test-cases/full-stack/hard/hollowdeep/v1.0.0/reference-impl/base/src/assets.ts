// Hollowdeep — load the PRODUCED assets (ASSETS.md / specs/assets.md).
//
// Every sprite, sprite-sheet frame, particle system, and sound the game plays was
// produced during the build with the on-PATH tools and committed under assets/. They are
// loaded here through Vite's import globs, so every URL resolves page-relative under any
// base path (vite.config sets base "./"), exactly as ASSETS.md requires — never a
// root-absolute "/assets/…" URL. The runtime only LOADS these files.
//
// Sprites are keyed by their ASSETS.md path minus the "../assets/" prefix and ".png"
// suffix — e.g. "tiles/dirt", "machines/generator", "items/ore", "icons/oxygen". The
// delver sheets are one PNG per frame under "delver/<anim>/<i>". The four fx systems and
// five audio clips are keyed by their base name.

import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type { Anim, Cue, FxKind } from "./types";

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
    img.onerror = () => reject(new Error(`Hollowdeep: failed to load ${url}`));
    img.src = url;
  });
}

// The produced delver sheet frame counts (ASSETS.md).
const ANIM_FRAMES: Record<Anim, number> = { walk: 6, dig: 4, carry: 4, idle: 4 };

// Which produced particle system drives each overlay/burst (ASSETS.md).
const FX_SOURCE: Record<FxKind, string> = {
  oxygen: "oxygen_haze",
  co2: "co2_plume",
  dust: "dig_dust",
  steam: "machine_steam",
};

// Which produced .wav plays for each sound cue (ASSETS.md).
const CUE_SOURCE: Record<Cue, string> = {
  dig: "dig",
  build: "build",
  alarm: "alarm",
  machine: "machine",
};

export interface Assets {
  sprite(name: string): HTMLImageElement;
  has(name: string): boolean;
  delver: Record<Anim, HTMLImageElement[]>;
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

  const sprite = (name: string): HTMLImageElement => {
    const img = imgs.get(name);
    if (!img) throw new Error(`Hollowdeep: missing sprite "${name}"`);
    return img;
  };

  const framesFor = (prefix: string, count: number): HTMLImageElement[] => {
    const out: HTMLImageElement[] = [];
    for (let i = 0; i < count; i++) {
      const img = imgs.get(`${prefix}/${i}`);
      if (img) out.push(img);
    }
    return out;
  };

  const delver = {} as Record<Anim, HTMLImageElement[]>;
  for (const anim of Object.keys(ANIM_FRAMES) as Anim[]) {
    delver[anim] = framesFor(`delver/${anim}`, ANIM_FRAMES[anim]);
  }

  const rawFx: Record<string, ParticleSystem> = {};
  for (const [globPath, sys] of Object.entries(fxJson)) {
    rawFx[keyOf(globPath, ".system.json").replace("fx/", "")] = sys;
  }
  const fx = {} as Record<FxKind, ParticleSystem | undefined>;
  for (const k of Object.keys(FX_SOURCE) as FxKind[]) fx[k] = rawFx[FX_SOURCE[k]];

  const rawWav: Record<string, string> = {};
  for (const [globPath, url] of Object.entries(wavUrls)) {
    rawWav[keyOf(globPath, ".wav").replace("audio/", "")] = url;
  }
  const audioUrl = {} as Record<Cue | "music", string>;
  for (const k of Object.keys(CUE_SOURCE) as Cue[]) audioUrl[k] = rawWav[CUE_SOURCE[k]] ?? "";
  audioUrl.music = rawWav.music ?? "";

  return {
    sprite,
    has: (name: string) => imgs.has(name),
    delver,
    fx,
    audioUrl,
  };
}
