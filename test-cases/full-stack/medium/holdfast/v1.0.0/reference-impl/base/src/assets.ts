// Holdfast — load the PRODUCED assets (ASSETS.md / specs/assets.md).
//
// Every sprite, sprite-sheet frame, particle system, and sound the game plays was
// produced during the build with the six on-PATH tools and committed under assets/. They
// are loaded here through Vite's import globs (page-relative, `?url`), so every URL
// resolves under any base path (vite.config sets base "./"), exactly as ASSETS.md
// requires — never a root-absolute "/assets/…" URL. Nothing here is drawn in code except
// the HUD/menu chrome the specs reserve for code.
//
// Keys are the path under assets/ without its extension: "terrain/soil", "nodes/tree",
// "structures/turret_idle", "items/wood", "icons/alert", and the sheet frames
// "settler/walk/0".."settler/walk/3", "raider/fight/0".. etc. The fx systems key by
// their FxKind ("muzzle"/"blood"/"impact"/"fire"/"explosion"/"dust"), and the .wav clips
// by their cue name plus the two looped beds ("ambient", "music").

import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type { Cue, FxKind } from "./types";

const pngUrls = import.meta.glob<string>("../assets/**/*.png", { eager: true, query: "?url", import: "default" });
const fxJson = import.meta.glob<ParticleSystem>("../assets/fx/*.system.json", { eager: true, import: "default" });
const wavUrls = import.meta.glob<string>("../assets/audio/*.wav", { eager: true, query: "?url", import: "default" });

const FX_KINDS: FxKind[] = ["muzzle", "blood", "impact", "fire", "explosion", "dust"];
const CUE_KINDS: Cue[] = ["gunshot", "hit", "build", "alarm"];
export type AudioName = Cue | "ambient" | "music";

function keyOf(globPath: string, ext: string): string {
  return globPath.replace("../assets/", "").replace(ext, "");
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Holdfast: failed to load ${url}`));
    img.src = url;
  });
}

export interface Assets {
  // A single produced sprite by its assets/ key (throws if missing — a build error).
  sprite(name: string): HTMLImageElement;
  has(name: string): boolean;
  // The N frames of a sheet cycle in order: frames("settler/walk", 4) → 0.png..3.png.
  frames(prefix: string, count: number): HTMLImageElement[];
  fx: Record<FxKind, ParticleSystem | undefined>;
  audioUrl: Record<AudioName, string>;
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
    if (!img) throw new Error(`Holdfast: missing sprite "${name}"`);
    return img;
  };

  const frames = (prefix: string, count: number): HTMLImageElement[] => {
    const out: HTMLImageElement[] = [];
    for (let i = 0; i < count; i++) {
      const img = imgs.get(`${prefix}/${i}`);
      if (img) out.push(img);
    }
    return out;
  };

  // Particle systems key by FxKind (the produced files share the FxKind names).
  const rawFx: Record<string, ParticleSystem> = {};
  for (const [globPath, sys] of Object.entries(fxJson)) {
    rawFx[keyOf(globPath, ".system.json").replace("fx/", "")] = sys;
  }
  const fx = {} as Record<FxKind, ParticleSystem | undefined>;
  for (const k of FX_KINDS) fx[k] = rawFx[k];

  // Audio urls key by cue name, plus the two looped beds.
  const rawWav: Record<string, string> = {};
  for (const [globPath, url] of Object.entries(wavUrls)) {
    rawWav[keyOf(globPath, ".wav").replace("audio/", "")] = url;
  }
  const audioUrl = {} as Record<AudioName, string>;
  for (const k of CUE_KINDS) audioUrl[k] = rawWav[k] ?? "";
  audioUrl.ambient = rawWav.ambient ?? "";
  audioUrl.music = rawWav.music ?? "";

  return {
    sprite,
    has: (name: string) => imgs.has(name),
    frames,
    fx,
    audioUrl,
  };
}
