// Volute — the produced asset set (specs/assets.md).
//
// Every sprite, sheet frame, particle system and cue the game shows or plays was
// produced with the six asset tools, committed under `assets/`, and is bundled
// from there. NO TOOL RUNS AT BUILD TIME: `npm ci` and `npm run build` only copy
// and hash these files.
//
// Each URL is resolved through the bundler with `import.meta.glob`, and
// `vite.config.ts` sets `base: "./"`, so every URL the built site requests is
// PAGE-RELATIVE — the `dist/` directory runs from the root of a static host and
// from any sub-path of one alike.
//
// The decoded images, parsed systems and undecoded audio bytes are NOT game state:
// the state advances without them, and the renderer and the audio bus hold them.

import type { ParticleSystem } from "@clockwyrks/particle-runtime";
import { CHARGE_IDS, CUES, MACHINERY_KINDS } from "./constants";
import type { ChargeId, CueName, MachineryKind } from "./constants";

const pngUrls = import.meta.glob<string>("../assets/**/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});
const systemJson = import.meta.glob<ParticleSystem>(
  "../assets/fx/*.system.json",
  { eager: true, import: "default" },
);
const wavUrls = import.meta.glob<string>("../assets/audio/*.wav", {
  eager: true,
  query: "?url",
  import: "default",
});

/** `../assets/cores/halide.png` becomes `cores/halide`. */
function keyOf(globPath: string, extension: string): string {
  return globPath.slice("../assets/".length, -extension.length);
}

/** The URL of a produced file, by its key under `assets/`. */
export function spriteUrl(key: string): string | undefined {
  return pngUrls[`../assets/${key}.png`];
}

/** The produced particle systems this build plays, by name. */
export const PARTICLE_SYSTEMS = [
  "extraction-burst",
  "bore-detonation",
  "intake-spray",
  "pickup-shimmer",
] as const;

/** One of the four produced particle systems. */
export type SystemName = (typeof PARTICLE_SYSTEMS)[number];

/** The frames each produced sheet holds. */
export const SHEETS = {
  "fire-recoil": 4,
  "maw-swallow": 6,
  "extraction-flash": 6,
} as const;

/** One of the three produced sheets. */
export type SheetName = keyof typeof SHEETS;

/** Everything the renderer and the audio bus were handed at start-up. */
export interface Assets {
  /** One core sprite per charge, 28 x 28. */
  readonly cores: Readonly<Record<ChargeId, HTMLImageElement>>;
  /** One mark badge per machinery kind, 16 x 16. */
  readonly marks: Readonly<Record<MachineryKind, HTMLImageElement>>;
  /** The injector, the intake, and the channel tile. */
  readonly injectorBase: HTMLImageElement;
  readonly injectorBarrel: HTMLImageElement;
  readonly intakeMaw: HTMLImageElement;
  readonly channelPlate: HTMLImageElement;
  /** The two HUD icons, 24 x 24. */
  readonly cellIcon: HTMLImageElement;
  readonly pressureIcon: HTMLImageElement;
  /** The three sheets, frame by frame. */
  readonly sheets: Readonly<Record<SheetName, HTMLImageElement[]>>;
  /** The four produced particle systems, parsed. */
  readonly systems: Readonly<Record<SystemName, ParticleSystem>>;
  /** The fifteen cues, as undecoded file bytes the audio bus decodes on unlock. */
  readonly audio: Readonly<Record<CueName, ArrayBuffer | null>>;
}

/** Decode one produced PNG. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Volute: could not load ${url}`));
    image.src = url;
  });
}

/** Fetch one produced `.wav`, or `null` where the fetch fails. */
async function loadBytes(url: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

/** Decode every produced file the game shows or plays. */
export async function loadAssets(): Promise<Assets> {
  const images = new Map<string, HTMLImageElement>();
  await Promise.all(
    Object.entries(pngUrls).map(async ([path, url]) => {
      images.set(keyOf(path, ".png"), await loadImage(url));
    }),
  );

  const need = (key: string): HTMLImageElement => {
    const image = images.get(key);
    if (image === undefined) {
      throw new Error(`Volute: the produced sprite "${key}" is missing`);
    }
    return image;
  };

  const cores = {} as Record<ChargeId, HTMLImageElement>;
  for (const charge of CHARGE_IDS) cores[charge] = need(`cores/${charge}`);

  const marks = {} as Record<MachineryKind, HTMLImageElement>;
  for (const kind of MACHINERY_KINDS) marks[kind] = need(`marks/${kind}`);

  const sheets = {} as Record<SheetName, HTMLImageElement[]>;
  for (const name of Object.keys(SHEETS) as SheetName[]) {
    sheets[name] = Array.from({ length: SHEETS[name] }, (_unused, frame) =>
      need(`sheets/${name}/${frame}`),
    );
  }

  const systems = {} as Record<SystemName, ParticleSystem>;
  for (const [path, system] of Object.entries(systemJson)) {
    const name = keyOf(path, ".system.json") as `fx/${SystemName}`;
    systems[name.slice("fx/".length) as SystemName] = system;
  }

  const audio = {} as Record<CueName, ArrayBuffer | null>;
  await Promise.all(
    CUES.map(async (cue) => {
      const url = wavUrls[`../assets/audio/${cue}.wav`];
      audio[cue] = url === undefined ? null : await loadBytes(url);
    }),
  );

  return {
    cores,
    marks,
    injectorBase: need("machine/injector-base"),
    injectorBarrel: need("machine/injector-barrel"),
    intakeMaw: need("machine/intake-maw"),
    channelPlate: need("machine/channel-plate"),
    cellIcon: need("hud/cell"),
    pressureIcon: need("hud/pressure"),
    sheets,
    systems,
    audio,
  };
}
