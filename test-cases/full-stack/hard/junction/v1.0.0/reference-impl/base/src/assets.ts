// Junction — load the PRODUCED assets (specs/assets.md, ASSETS.md).
//
// Every sprite, sprite-sheet frame, particle system, and sound the game plays was produced
// during the build with the on-PATH tools (draw / draw-sheet / particle-2d / sfx-synth /
// music) and committed under assets/. They are loaded here through Vite's import globs, so
// every URL resolves PAGE-RELATIVE under any base path (vite.config sets base "./") — never
// a root-absolute "/assets/…" URL. The tools are never invoked by `npm run build`; the game
// only loads their output.

import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type { Cue, FxKind, Tool, ZoneKind } from "./types";
import { TOOL_BY_KIND } from "./constants";

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
    img.onerror = () => reject(new Error(`Junction: failed to load ${url}`));
    img.src = url;
  });
}

// The three animation sheets and their frame counts (ASSETS.md §2).
export type AnimName = "signal" | "construction" | "tram";
const ANIMS: Record<AnimName, number> = { signal: 4, construction: 4, tram: 4 };

// Which produced particle system stands in for each runtime FxKind (ASSETS.md §3).
const FX_SOURCE: Record<FxKind, string> = {
  haze: "pollution",
  dust: "dust",
  fireworks: "fireworks",
};

// Which produced .wav stands in for each sound cue (ASSETS.md §4). Cue names map 1:1.
const CUE_SOURCE: Record<Cue, string> = {
  build: "build",
  chime: "chime",
  alert: "alert",
};

export interface Assets {
  sprite(name: string): HTMLImageElement; // by asset key (no extension), e.g. "zones/res_1"
  has(name: string): boolean;
  anim: Record<AnimName, HTMLImageElement[]>;
  fx: Record<FxKind, ParticleSystem | undefined>;
  audioUrl: Record<Cue | "hum" | "music", string>;
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
    if (!img) throw new Error(`Junction: missing sprite "${name}"`);
    return img;
  };

  const framesFor = (dir: string, count: number): HTMLImageElement[] => {
    const out: HTMLImageElement[] = [];
    for (let i = 0; i < count; i++) {
      const img = imgs.get(`anim/${dir}/${i}`);
      if (img) out.push(img);
    }
    return out;
  };
  const anim = {} as Record<AnimName, HTMLImageElement[]>;
  for (const name of Object.keys(ANIMS) as AnimName[]) anim[name] = framesFor(name, ANIMS[name]);

  const rawFx: Record<string, ParticleSystem> = {};
  for (const [globPath, sys] of Object.entries(fxJson)) rawFx[keyOf(globPath, ".system.json").replace("fx/", "")] = sys;
  const fx = {} as Record<FxKind, ParticleSystem | undefined>;
  for (const k of Object.keys(FX_SOURCE) as FxKind[]) fx[k] = rawFx[FX_SOURCE[k]];

  const rawWav: Record<string, string> = {};
  for (const [globPath, url] of Object.entries(wavUrls)) rawWav[keyOf(globPath, ".wav").replace("audio/", "")] = url;
  const audioUrl = {} as Record<Cue | "hum" | "music", string>;
  for (const k of Object.keys(CUE_SOURCE) as Cue[]) audioUrl[k] = rawWav[CUE_SOURCE[k]] ?? "";
  audioUrl.hum = rawWav.hum ?? "";
  audioUrl.music = rawWav.music ?? "";

  return {
    sprite,
    has: (name: string) => imgs.has(name),
    anim,
    fx,
    audioUrl,
  };
}

// ---- Typed sprite lookups (DESIGN §4) ------------------------------------------

// The produced building sprite for a developed tile's (zone, tier). Tier is clamped to
// 1..3 — an empty lot (tier 0) is drawn in code, not from a sprite (ASSETS.md §1.1).
export function zoneSprite(zone: ZoneKind, tier: number): string {
  return `zones/${zone}_${Math.max(1, Math.min(3, tier))}`;
}

// Road sprite + rotation selected from the 4-neighbour road bitmask (N=1,E=2,S=4,W=8).
// Base orientations, from the produced art (scripts/gen-sprites.sh):
//   road_straight — vertical, connects N+S
//   road_corner   — elbow, connects S+E
//   road_end      — stub cap, opens S (down)
//   road_junction — symmetric 4-way cross (covers 3- and 4-way tiles)
// `rot` is a clockwise rotation in radians the renderer applies about the tile centre.
export function roadSprite(mask: number): { sprite: string; rot: number } {
  const N = 1;
  const E = 2;
  const S = 4;
  const W = 8;
  const m = mask & 0b1111;
  const count = (m & N ? 1 : 0) + (m & E ? 1 : 0) + (m & S ? 1 : 0) + (m & W ? 1 : 0);
  const Q = Math.PI / 2;

  if (count >= 3) return { sprite: "transit/road_junction", rot: 0 };
  if (count === 2) {
    if (m === (N | S)) return { sprite: "transit/road_straight", rot: 0 };
    if (m === (E | W)) return { sprite: "transit/road_straight", rot: Q };
    // Corner: base connects {E,S}; rotate clockwise q turns to match.
    // q=0→{E,S}=6, q=1→{S,W}=12, q=2→{W,N}=9, q=3→{N,E}=3.
    const cornerRot: Record<number, number> = { 6: 0, 12: 1, 9: 2, 3: 3 };
    return { sprite: "transit/road_corner", rot: (cornerRot[m] ?? 0) * Q };
  }
  if (count === 1) {
    // End cap opens toward the single connection; base opens S (dir 2).
    const dir = m & N ? 0 : m & E ? 1 : m & S ? 2 : 3;
    return { sprite: "transit/road_end", rot: ((dir - 2 + 4) % 4) * Q };
  }
  return { sprite: "transit/road_end", rot: 0 }; // isolated stub
}

// The produced glyph a tool's palette button / HUD chip draws (ASSETS.md §1.5).
export function iconOf(tool: Tool): string {
  return TOOL_BY_KIND[tool].icon;
}
