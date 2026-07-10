/// <reference types="vite/client" />
// Fathom — provided art assets (specs/assets.md).
//
// Every sprite sheet is a folder of per-frame PNGs under `assets/`. They are
// imported through Vite's glob so their URLs resolve relative to the emitted
// bundle (page-relative), which keeps the build working under any base path
// (the per-run sub-path). Nothing here uses a root-absolute `/assets/...` URL.

// Eagerly resolve every frame URL of every sheet. The keys look like
// "../assets/glimmerfin/0.png"; the values are the bundled, page-relative URLs.
const urls = import.meta.glob("../assets/**/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function sheetUrls(folder: string): string[] {
  const prefix = `../assets/${folder}/`;
  const entries: { i: number; url: string }[] = [];
  for (const key in urls) {
    if (!key.startsWith(prefix)) continue;
    const name = key.slice(prefix.length); // e.g. "10.png"
    const i = parseInt(name, 10);
    if (Number.isFinite(i)) entries.push({ i, url: urls[key] });
  }
  entries.sort((a, b) => a.i - b.i);
  return entries.map((e) => e.url);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Fathom: failed to load ${url}`));
    img.src = url;
  });
}

async function loadSheet(folder: string): Promise<HTMLImageElement[]> {
  return Promise.all(sheetUrls(folder).map(loadImage));
}

export interface Assets {
  glimmerfin: HTMLImageElement[]; // 8 — forager
  lanternjaw: HTMLImageElement[]; // 16 — the Lanternjaw: 0-7 hunt swim (jaws), 8-15 wander (the jellyfish disguise, identical to `drifter`)
  gloamfin: HTMLImageElement[]; // 8 — the Gloamfin
  flarefish: HTMLImageElement[]; // 8 — the Flarefish
  drifter: HTMLImageElement[]; // 8 — the bonus drifter (jellyfish; the very frames a wandering Lanternjaw wears as its disguise)
  trench: HTMLImageElement[]; // 19 — wall autotile + floor + fog + gate
  flareBloom: HTMLImageElement[]; // 8 — the flare (additive, no tint)
  // The sonar pulse is drawn procedurally as a travelling wavefront (render.ts),
  // not from a sprite sheet — a sprite can only ever be a circle, and the pulse
  // reflects along the corridors (specs/sensing.md).
}

export async function loadAssets(): Promise<Assets> {
  const [glimmerfin, lanternjaw, gloamfin, flarefish, drifter, trench, flareBloom] =
    await Promise.all([
      loadSheet("glimmerfin"),
      loadSheet("lanternjaw"),
      loadSheet("gloamfin"),
      loadSheet("flarefish"),
      loadSheet("drifter"),
      loadSheet("trench-walls"),
      loadSheet("flare-bloom"),
    ]);
  return {
    glimmerfin,
    lanternjaw,
    gloamfin,
    flarefish,
    drifter,
    trench,
    flareBloom,
  };
}
