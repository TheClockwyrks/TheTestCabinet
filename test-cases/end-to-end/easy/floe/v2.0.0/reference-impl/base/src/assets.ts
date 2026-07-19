/// <reference types="vite/client" />
// Floe — sprite loading (specs/assets.md).
//
// Every provided sprite is a folder of one PNG per frame. We let Vite resolve the
// URLs with an eager directory glob, so each URL is page-relative (base: "./") and
// the build runs unchanged under any sub-path. NEVER build a root-absolute
// `/assets/...` string at runtime — that would 404 when served from a sub-path.

const urlModules = import.meta.glob("../assets/**/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export interface Sprites {
  crosser: HTMLImageElement[]; // 8 frames (32x32)
  bear: HTMLImageElement[]; // 18 frames (32x32)
  plow: HTMLImageElement; // 96x32
  dogsled: HTMLImageElement; // 64x32
  car: HTMLImageElement; // 64x32
  pan: HTMLImageElement; // 32x32
  raft: HTMLImageElement[]; // [0]=3-tile (left 96), [1]=4-tile (128x32)
}

// folder -> frame index -> url
function groupByFolder(): Map<string, string[]> {
  const folders = new Map<string, string[]>();
  for (const [path, url] of Object.entries(urlModules)) {
    const m = path.match(/\/assets\/([^/]+)\/(\d+)\.png$/);
    if (!m) continue;
    const folder = m[1];
    const index = Number(m[2]);
    let frames = folders.get(folder);
    if (!frames) {
      frames = [];
      folders.set(folder, frames);
    }
    frames[index] = url;
  }
  return folders;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Floe: failed to load sprite ${url}`));
    img.src = url;
  });
}

async function loadFolder(
  folders: Map<string, string[]>,
  name: string,
): Promise<HTMLImageElement[]> {
  const urls = folders.get(name);
  if (!urls || urls.length === 0) {
    throw new Error(`Floe: missing sprite folder assets/${name}/`);
  }
  return Promise.all(urls.map(loadImage));
}

export async function loadSprites(): Promise<Sprites> {
  const folders = groupByFolder();
  const [crosser, bear, plow, dogsled, car, pan, raft] = await Promise.all([
    loadFolder(folders, "crosser"),
    loadFolder(folders, "bear"),
    loadFolder(folders, "plow"),
    loadFolder(folders, "dogsled"),
    loadFolder(folders, "car"),
    loadFolder(folders, "pan"),
    loadFolder(folders, "raft"),
  ]);
  return {
    crosser,
    bear,
    plow: plow[0],
    dogsled: dogsled[0],
    car: car[0],
    pan: pan[0],
    raft,
  };
}
