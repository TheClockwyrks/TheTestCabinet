// Coil — load the PRODUCED snake sprites and audio (ASSETS.md, specs/assets.md).
//
// The snake's whole sprite set (an animated biting head, the straight body, the corner,
// and the tapering tail) and the game's sound (eat / combo / death cues + the music bed)
// were produced during the build with the on-PATH tools and committed under assets/. They
// are loaded here through Vite's import globs so every URL resolves PAGE-RELATIVE under any
// base path (vite.config sets base "./"), exactly as specs/assets.md requires — never a
// root-absolute "/assets/…" URL. The runtime only LOADS these committed files; it never
// invokes the tools.

const pngUrls = import.meta.glob<string>("../assets/**/*.png", { eager: true, query: "?url", import: "default" });
const wavUrls = import.meta.glob<string>("../assets/audio/*.wav", { eager: true, query: "?url", import: "default" });

function keyOf(globPath: string, ext: string): string {
  return globPath.replace("../assets/", "").replace(ext, "");
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Coil: failed to load ${url}`));
    img.src = url;
  });
}

export type AudioCue = "eat" | "combo" | "death" | "music";

export interface SnakeSprites {
  head: HTMLImageElement[]; // frames [0,1,2,3]: 0 = resting, 1..3 = bite
  body: HTMLImageElement;
  corner: HTMLImageElement;
  tail: HTMLImageElement;
}

export interface Assets {
  snake: SnakeSprites;
  audioUrl: Record<AudioCue, string>;
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
    if (!img) throw new Error(`Coil: missing sprite "${name}"`);
    return img;
  };

  const head: HTMLImageElement[] = [];
  for (let i = 0; i < 4; i++) head.push(sprite(`snake/head/${i}`));

  const snake: SnakeSprites = {
    head,
    body: sprite("snake/body"),
    corner: sprite("snake/corner"),
    tail: sprite("snake/tail"),
  };

  const rawWav: Record<string, string> = {};
  for (const [globPath, url] of Object.entries(wavUrls)) {
    rawWav[keyOf(globPath, ".wav").replace("audio/", "")] = url;
  }
  const audioUrl: Record<AudioCue, string> = {
    eat: rawWav.eat ?? "",
    combo: rawWav.combo ?? "",
    death: rawWav.death ?? "",
    music: rawWav.music ?? "",
  };

  return { snake, audioUrl };
}
