// Valence — load the PRODUCED assets (specs/assets.md).
//
// Every sprite, sprite-sheet frame, particle system, and sound the game plays was
// produced during the build with the on-PATH tools and committed under assets/. They
// are loaded here through Vite's import globs, so every URL resolves page-relative
// under any base path (vite.config sets base "./"), exactly as specs/assets.md
// requires — never a root-absolute "/assets/…" URL.

import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type { FxKind, Cue } from "./types";
import type { TowerKind } from "./constants";

// PNG sprites and sprite-sheet frames as page-relative URLs.
const pngUrls = import.meta.glob<string>("../assets/**/*.png", { eager: true, query: "?url", import: "default" });
// Particle systems — the emitted system.json files, imported as parsed JSON.
const fxJson = import.meta.glob<ParticleSystem>("../assets/fx/*.system.json", { eager: true, import: "default" });
// Audio clips as page-relative URLs.
const wavUrls = import.meta.glob<string>("../assets/audio/*.wav", { eager: true, query: "?url", import: "default" });

// Map a glob key ("../assets/towers/ionizer_1.png") to a logical name ("towers/ionizer_1").
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

export interface Assets {
  sprite(name: string): HTMLImageElement; // by logical name, e.g. "matter/nucleus_i"
  has(name: string): boolean;
  electron: HTMLImageElement[]; // 8-frame orbiting-electron overlay
  boss: HTMLImageElement[]; // 8-frame boss seethe cycle
  towerFire: Record<"ionizer" | "shear" | "fission", HTMLImageElement[]>; // 4-frame fire overlays
  fx: Record<FxKind, ParticleSystem>;
  audioUrl: Record<Cue | "music", string>;
}

export async function loadAssets(): Promise<Assets> {
  const names = Object.keys(pngUrls).map((k) => keyOf(k, ".png"));
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

  const fx = {} as Record<FxKind, ParticleSystem>;
  for (const [globPath, sys] of Object.entries(fxJson)) {
    const kind = keyOf(globPath, ".system.json").replace("fx/", "") as FxKind;
    fx[kind] = sys as ParticleSystem;
  }

  const audioUrl = {} as Record<Cue | "music", string>;
  for (const [globPath, url] of Object.entries(wavUrls)) {
    const name = keyOf(globPath, ".wav").replace("audio/", "") as Cue | "music";
    audioUrl[name] = url;
  }

  const towerFire: Record<"ionizer" | "shear" | "fission", HTMLImageElement[]> = {
    ionizer: framesFor("towers/ionizer_fire", 4),
    shear: framesFor("towers/shear_fire", 4),
    fission: framesFor("towers/fission_fire", 4),
  };

  void names; // (kept for debugging: the full sprite name list)

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

// The tower base sprite name for a kind and level (1..3).
export function towerSprite(kind: TowerKind, level: number): string {
  return `towers/${kind}_${Math.max(1, Math.min(3, level))}`;
}
