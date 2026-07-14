// Deepcore — load the PRODUCED assets (specs/assets.md, ASSET-LAYOUT.md).
//
// Every sprite, sprite-sheet frame, particle `system.json`, and .wav the game plays is
// produced during the run with the six on-PATH tools and committed under assets/. They
// are discovered here through Vite import globs, so every URL resolves PAGE-RELATIVE
// under any base path (vite.config sets base "./") — never a root-absolute "/assets/…".
// The loader tolerates not-yet-present files: a missing sprite/effect/clip yields an
// undefined entry and the renderer draws a neutral fallback, so `npm run build` and a
// headless load both succeed before the assets land.

import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type { MinerState, Ore } from "./types";
import type { FxKind } from "./particles";
import type { Cue, LoopCue } from "./audio";

const pngUrls = import.meta.glob<string>("../assets/**/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});
const fxJson = import.meta.glob<ParticleSystem>("../assets/fx/*.json", { eager: true, import: "default" });
const wavUrls = import.meta.glob<string>("../assets/audio/*.wav", {
  eager: true,
  query: "?url",
  import: "default",
});

/** Strip the `../assets/` prefix and a trailing extension → a stable key. */
function keyOf(globPath: string, ext: string): string {
  return globPath.replace("../assets/", "").replace(ext, "");
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img); // resolve anyway; renderer falls back on !complete/!naturalWidth
    img.src = url;
  });
}

const MINER_STATES: MinerState[] = [
  "idle",
  "walk",
  "drill-down",
  "drill-side",
  "jetpack",
  "fall",
  "hurt",
  "fuel-out",
];

const FX_KINDS: FxKind[] = [
  "drill-debris",
  "jetpack-exhaust",
  "ore-sparkle",
  "material-shimmer",
  "gas-explosion",
  "lava-embers",
  "impact-dust",
  "core-extract",
  "core-detonation",
  "launch-exhaust",
  "death-burst",
];

const AUDIO_NAMES: (Cue | LoopCue)[] = [
  "drill",
  "thrust",
  "ore-pickup",
  "material-chime",
  "gas-explosion",
  "lava-sizzle",
  "impact",
  "fabricate",
  "launch",
  "death",
  "alarm-fuel",
  "alarm-core",
  "music",
];

export interface Assets {
  /** Miner cycle frames per state (empty array if not produced yet). */
  miner: Record<MinerState, HTMLImageElement[]>;
  /** A band/tunnel/bedrock tile sprite by name, or undefined. */
  tile(name: string): HTMLImageElement | undefined;
  ore(o: Ore): HTMLImageElement | undefined;
  material(name: string): HTMLImageElement | undefined;
  gas: HTMLImageElement | undefined;
  lava: HTMLImageElement[];
  surface(name: string): HTMLImageElement | undefined;
  rocket: HTMLImageElement[]; // stage0..stage5
  icon(name: string): HTMLImageElement | undefined;
  fx: Partial<Record<FxKind, ParticleSystem>>;
  audioUrls: Record<Cue | LoopCue, string>;
}

export async function loadAssets(): Promise<Assets> {
  const imgs = new Map<string, HTMLImageElement>();
  await Promise.all(
    Object.entries(pngUrls).map(async ([globPath, url]) => {
      imgs.set(keyOf(globPath, ".png"), await loadImage(url));
    }),
  );

  const framesFor = (prefix: string): HTMLImageElement[] => {
    const out: { i: number; img: HTMLImageElement }[] = [];
    for (const [k, img] of imgs) {
      if (!k.startsWith(prefix)) continue;
      const m = k.slice(prefix.length).match(/(\d+)$/);
      if (m) out.push({ i: parseInt(m[1]!, 10), img });
    }
    out.sort((a, b) => a.i - b.i);
    return out.map((e) => e.img);
  };

  const miner = {} as Record<MinerState, HTMLImageElement[]>;
  for (const s of MINER_STATES) miner[s] = framesFor(`miner/${s}/frame`);

  const lava = framesFor("hazards/lava/frame");

  const rocket: HTMLImageElement[] = [];
  for (let i = 0; i <= 5; i++) {
    const img = imgs.get(`rocket/stage${i}`);
    if (img) rocket[i] = img;
  }

  const fx: Partial<Record<FxKind, ParticleSystem>> = {};
  for (const [globPath, sys] of Object.entries(fxJson)) {
    const name = keyOf(globPath, ".json").replace("fx/", "") as FxKind;
    if (FX_KINDS.includes(name)) fx[name] = sys;
  }

  const audioUrls = {} as Record<Cue | LoopCue, string>;
  const rawWav = new Map<string, string>();
  for (const [globPath, url] of Object.entries(wavUrls)) rawWav.set(keyOf(globPath, ".wav").replace("audio/", ""), url);
  for (const n of AUDIO_NAMES) audioUrls[n] = rawWav.get(n) ?? "";

  return {
    miner,
    tile: (name) => imgs.get(`tiles/${name}`),
    ore: (o) => imgs.get(`ore/${o}`),
    material: (name) => imgs.get(`materials/${name}`),
    gas: imgs.get("hazards/gas"),
    lava,
    surface: (name) => imgs.get(`surface/${name}`),
    rocket,
    icon: (name) => imgs.get(`icons/${name}`),
    fx,
    audioUrls,
  };
}

/** Whether an image actually decoded (a produced file exists), for fallback drawing. */
export function isReady(img: HTMLImageElement | undefined): img is HTMLImageElement {
  return !!img && img.complete && img.naturalWidth > 0;
}
