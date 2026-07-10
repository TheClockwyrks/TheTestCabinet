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

// Multiply a grayscale sprite frame by a tint color, preserving alpha — the
// runtime tint the sonar-pulse sheet needs (specs/assets.md). Returns a canvas.
function tint(img: HTMLImageElement, color: string): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = img.width;
  cv.height = img.height;
  const g = cv.getContext("2d")!;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = "multiply";
  g.fillStyle = color;
  g.fillRect(0, 0, cv.width, cv.height);
  // Restore the original straight alpha (multiply left the transparent margin
  // opaque-tinted).
  g.globalCompositeOperation = "destination-in";
  g.drawImage(img, 0, 0);
  return cv;
}

export interface Assets {
  glimmerfin: HTMLImageElement[]; // 8 — forager
  lanternjaw: HTMLImageElement[]; // 16 — the Lanternjaw
  gloamfin: HTMLImageElement[]; // 8 — the Gloamfin
  flarefish: HTMLImageElement[]; // 8 — the Flarefish
  trench: HTMLImageElement[]; // 19 — wall autotile + floor + fog + gate
  flareBloom: HTMLImageElement[]; // 8 — the flare (additive, no tint)
  sonarCyan: HTMLCanvasElement[]; // 8 — the forager's pulse (#5ef2ff)
  sonarViolet: HTMLCanvasElement[]; // 8 — the Gloamfin's pulse (#c46bff)
}

export async function loadAssets(): Promise<Assets> {
  const [glimmerfin, lanternjaw, gloamfin, flarefish, trench, flareBloom, sonar] =
    await Promise.all([
      loadSheet("glimmerfin"),
      loadSheet("lanternjaw"),
      loadSheet("gloamfin"),
      loadSheet("flarefish"),
      loadSheet("trench-walls"),
      loadSheet("flare-bloom"),
      loadSheet("sonar-pulse"),
    ]);
  return {
    glimmerfin,
    lanternjaw,
    gloamfin,
    flarefish,
    trench,
    flareBloom,
    sonarCyan: sonar.map((f) => tint(f, "#5ef2ff")),
    sonarViolet: sonar.map((f) => tint(f, "#c46bff")),
  };
}
