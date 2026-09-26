// Volute — the produced asset set (specs/assets.md).
//
// Every sprite, sheet frame, particle system and cue the game shows or plays was
// produced with the six asset tools and committed under `public/assets/`, which
// is the engine's asset root and which the build copies into `dist/` unchanged.
// NO TOOL RUNS AT BUILD TIME: `npm ci` and `npm run build` only copy these files.
//
// Every one is loaded through the engine's own loader — `api.assets.loadImage`
// for an image, `api.assets.load` for a system's JSON, and `api.audio.load` for a
// cue — so every URL resolves under that root and is PAGE-RELATIVE, and the
// `dist/` directory runs from the root of a static host and from any sub-path of
// one alike. Every load is awaited inside `initialize`, so nothing is still
// decoding on the first frame.
//
// A LOAD THAT FAILS DEGRADES rather than taking the hall down with it. A host
// that cannot decode an image — a headless process with no `createImageBitmap`,
// say — still gets a running, playable, inspectable game: the renderer draws the
// core in code where its sprite is missing, and the simulation neither knows nor
// cares. The decoded images and parsed systems are not game state, which is why
// they live here and in the module-level table `initialize` fills rather than in
// `VoluteState`.

import type { InitApi } from "@clockwyrks/simple-2d";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";
import { CHARGE_IDS, MACHINERY_KINDS } from "./constants";
import type { ChargeId, MachineryKind } from "./constants";
import type { VoluteState } from "./game";

/** The frames each produced sheet holds. */
export const SHEETS = {
  "fire-recoil": 4,
  "maw-swallow": 6,
  "extraction-flash": 6,
} as const;

/** One of the three produced sheets. */
export type SheetName = keyof typeof SHEETS;

/** The produced particle systems this build plays, by name. */
export const PARTICLE_SYSTEMS = [
  "extraction-burst",
  "bore-detonation",
  "intake-spray",
  "pickup-shimmer",
] as const;

/** One of the four produced particle systems. */
export type SystemName = (typeof PARTICLE_SYSTEMS)[number];

/** A decoded produced image, or `null` where the host could not decode it. */
export type Sprite = ImageBitmap | null;

/** Everything the renderer was handed at start-up. */
export interface Assets {
  /** One core sprite per charge, 28 x 28. */
  readonly cores: Readonly<Record<ChargeId, Sprite>>;
  /** One mark badge per machinery kind, 16 x 16. */
  readonly marks: Readonly<Record<MachineryKind, Sprite>>;
  /** The injector, the intake, and the channel tile. */
  readonly injectorBase: Sprite;
  readonly injectorBarrel: Sprite;
  readonly intakeMaw: Sprite;
  readonly channelPlate: Sprite;
  /** The two HUD icons, 24 x 24. */
  readonly cellIcon: Sprite;
  readonly pressureIcon: Sprite;
  /** The three sheets, frame by frame. */
  readonly sheets: Readonly<Record<SheetName, readonly Sprite[]>>;
  /** The four produced particle systems, parsed. */
  readonly systems: Readonly<Record<SystemName, ParticleSystem | null>>;
}

/**
 * An asset set holding nothing, which is what the game draws with until
 * `initialize` has finished loading.
 *
 * It exists so the module-level table the renderer reads is a complete value from
 * the moment the module loads, rather than something that might not be there yet.
 * No frame runs before `initialize` resolves, so nothing is ever actually drawn
 * from it; the renderer's own code-drawn fallbacks are what make that safe.
 */
export function emptyAssets(): Assets {
  const cores = {} as Record<ChargeId, Sprite>;
  for (const charge of CHARGE_IDS) cores[charge] = null;
  const marks = {} as Record<MachineryKind, Sprite>;
  for (const kind of MACHINERY_KINDS) marks[kind] = null;
  const sheets = {} as Record<SheetName, Sprite[]>;
  for (const name of Object.keys(SHEETS) as SheetName[]) {
    sheets[name] = Array.from({ length: SHEETS[name] }, () => null);
  }
  const systems = {} as Record<SystemName, ParticleSystem | null>;
  for (const name of PARTICLE_SYSTEMS) systems[name] = null;
  return {
    cores,
    marks,
    injectorBase: null,
    injectorBarrel: null,
    intakeMaw: null,
    channelPlate: null,
    cellIcon: null,
    pressureIcon: null,
    sheets,
    systems,
  };
}

/** What `loadAssets` needs of the engine: its two loaders, and nothing else. */
export type AssetApi = Pick<InitApi<VoluteState>, "assets">;

/** Decode one produced image, or report `null` where it could not be decoded. */
function image(api: AssetApi, path: string): Promise<Sprite> {
  return api.assets.loadImage(path).catch(() => null);
}

/** Parse one produced particle system, or `null` where it could not be read. */
async function system(
  api: AssetApi,
  name: SystemName,
): Promise<ParticleSystem | null> {
  try {
    const blob = await api.assets.load(`fx/${name}.system.json`);
    return JSON.parse(await blob.text()) as ParticleSystem;
  } catch {
    return null;
  }
}

/** Load every produced file the game draws, awaited. */
export async function loadAssets(api: AssetApi): Promise<Assets> {
  const [
    coreList,
    markList,
    injectorBase,
    injectorBarrel,
    intakeMaw,
    channelPlate,
    cellIcon,
    pressureIcon,
    sheetList,
    systemList,
  ] = await Promise.all([
    Promise.all(CHARGE_IDS.map((charge) => image(api, `cores/${charge}.png`))),
    Promise.all(MACHINERY_KINDS.map((kind) => image(api, `marks/${kind}.png`))),
    image(api, "machine/injector-base.png"),
    image(api, "machine/injector-barrel.png"),
    image(api, "machine/intake-maw.png"),
    image(api, "machine/channel-plate.png"),
    image(api, "hud/cell.png"),
    image(api, "hud/pressure.png"),
    Promise.all(
      (Object.keys(SHEETS) as SheetName[]).map((name) =>
        Promise.all(
          Array.from({ length: SHEETS[name] }, (_unused, frame) =>
            image(api, `sheets/${name}/${frame}.png`),
          ),
        ),
      ),
    ),
    Promise.all(PARTICLE_SYSTEMS.map((name) => system(api, name))),
  ]);

  const cores = {} as Record<ChargeId, Sprite>;
  CHARGE_IDS.forEach((charge, index) => {
    cores[charge] = coreList[index];
  });

  const marks = {} as Record<MachineryKind, Sprite>;
  MACHINERY_KINDS.forEach((kind, index) => {
    marks[kind] = markList[index];
  });

  const sheets = {} as Record<SheetName, Sprite[]>;
  (Object.keys(SHEETS) as SheetName[]).forEach((name, index) => {
    sheets[name] = sheetList[index];
  });

  const systems = {} as Record<SystemName, ParticleSystem | null>;
  PARTICLE_SYSTEMS.forEach((name, index) => {
    systems[name] = systemList[index];
  });

  return {
    cores,
    marks,
    injectorBase,
    injectorBarrel,
    intakeMaw,
    channelPlate,
    cellIcon,
    pressureIcon,
    sheets,
    systems,
  };
}
