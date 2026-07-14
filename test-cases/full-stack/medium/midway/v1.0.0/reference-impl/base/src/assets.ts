// Midway — load the PRODUCED assets (specs/assets.md, ASSETS.md).
//
// Every sprite, sprite-sheet frame, particle system, and sound the game shows or plays
// was produced during the build with the six on-PATH tools and committed under assets/.
// They are loaded here through Vite's import globs, so every URL resolves PAGE-RELATIVE
// under any base path (vite.config sets base "./") — never a root-absolute "/assets/…"
// URL, so the built dist/ runs from a per-run sub-path. The keys below are the exact
// ASSETS.md paths (e.g. "tiles/grass", "icons/cash", "ride/carousel/0").

import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type { RideKind, StaffKind } from "./constants";
import { RIDE_ORDER, STAFF_ORDER } from "./constants";
import type { Cue, FxKind, GuestMood } from "./types";

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
    img.onerror = () => reject(new Error(`Midway: failed to load ${url}`));
    img.src = url;
  });
}

const GUEST_MOODS: GuestMood[] = ["walk", "happy", "angry", "eating"];
const FX_KINDS: FxKind[] = ["fireworks", "steam", "sparkle", "cleanup"];

export interface Assets {
  sprite(name: string): HTMLImageElement; // a single produced sprite by ASSETS.md path
  has(name: string): boolean;
  frames(prefix: string): HTMLImageElement[]; // an animation's frame array (prefix/0…N)
  guest: Record<GuestMood, HTMLImageElement[]>; // walk/happy/angry/eating (guest/<mood>)
  ride: Record<RideKind, HTMLImageElement[]>; // motion frames (ride/<kind>)
  staff: Record<StaffKind, HTMLImageElement[]>; // walk frames (staff/<kind>)
  fx: Record<FxKind, ParticleSystem | undefined>;
  audioUrl: Record<Cue, string>; // coin/ding/alarm/crowd/music
}

export async function loadAssets(): Promise<Assets> {
  const imgs = new Map<string, HTMLImageElement>();
  await Promise.all(
    Object.entries(pngUrls).map(async ([globPath, url]) => {
      imgs.set(keyOf(globPath, ".png"), await loadImage(url));
    }),
  );

  // An animation's frames: prefix/0, prefix/1, … up to the first gap.
  const frames = (prefix: string): HTMLImageElement[] => {
    const out: HTMLImageElement[] = [];
    for (let i = 0; ; i++) {
      const img = imgs.get(`${prefix}/${i}`);
      if (!img) break;
      out.push(img);
    }
    return out;
  };

  const sprite = (name: string): HTMLImageElement => {
    const img = imgs.get(name);
    if (!img) throw new Error(`Midway: missing sprite "${name}"`);
    return img;
  };

  const guest = {} as Record<GuestMood, HTMLImageElement[]>;
  for (const mood of GUEST_MOODS) guest[mood] = frames(`guest/${mood}`);

  const ride = {} as Record<RideKind, HTMLImageElement[]>;
  for (const kind of RIDE_ORDER) ride[kind] = frames(`ride/${kind}`);

  const staff = {} as Record<StaffKind, HTMLImageElement[]>;
  for (const kind of STAFF_ORDER) staff[kind] = frames(`staff/${kind}`);

  const rawFx: Record<string, ParticleSystem> = {};
  for (const [globPath, sys] of Object.entries(fxJson)) rawFx[keyOf(globPath, ".system.json").replace("fx/", "")] = sys;
  const fx = {} as Record<FxKind, ParticleSystem | undefined>;
  for (const k of FX_KINDS) fx[k] = rawFx[k];

  const rawWav: Record<string, string> = {};
  for (const [globPath, url] of Object.entries(wavUrls)) rawWav[keyOf(globPath, ".wav").replace("audio/", "")] = url;
  const audioUrl = {} as Record<Cue, string>;
  for (const k of ["coin", "ding", "alarm", "crowd", "music"] as Cue[]) audioUrl[k] = rawWav[k] ?? "";

  return {
    sprite,
    has: (name: string) => imgs.has(name),
    frames,
    guest,
    ride,
    staff,
    fx,
    audioUrl,
  };
}
