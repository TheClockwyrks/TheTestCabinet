// Sprite loading (specs/assets.md). The provided art lives in this project under
// `assets/` as one PNG per frame. We let Vite resolve every frame at build time
// via a directory glob, so each URL is page-relative and the build runs unchanged
// at any base path (a root-absolute `/assets/...` would 404 under a run sub-path).

// Eagerly import every frame's URL. Keys look like "../assets/node/0.png".
const urls = import.meta.glob("../assets/**/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export type SpriteName =
  | "node"
  | "worm"
  | "cursor"
  | "glitch"
  | "dropper"
  | "corruptor";

// name -> array of frame images, indexed by frame number.
const frames: Record<SpriteName, HTMLImageElement[]> = {
  node: [],
  worm: [],
  cursor: [],
  glitch: [],
  dropper: [],
  corruptor: [],
};

let pending = 0;
let ready = false;

for (const [key, url] of Object.entries(urls)) {
  // key: ".../assets/<name>/<index>.png"
  const m = key.match(/assets\/([^/]+)\/(\d+)\.png$/);
  if (!m) continue;
  const name = m[1] as SpriteName;
  const idx = Number(m[2]);
  if (!(name in frames)) continue;
  const img = new Image();
  pending++;
  img.onload = () => {
    pending--;
    if (pending === 0) ready = true;
  };
  img.onerror = () => {
    pending--;
    if (pending === 0) ready = true;
  };
  img.src = url;
  frames[name][idx] = img;
}
if (pending === 0) ready = true;

export const assetsReady = (): boolean => ready;

export function frame(name: SpriteName, index: number): HTMLImageElement {
  const arr = frames[name];
  return arr[index] ?? arr[0];
}

export function frameCount(name: SpriteName): number {
  return frames[name].length;
}
