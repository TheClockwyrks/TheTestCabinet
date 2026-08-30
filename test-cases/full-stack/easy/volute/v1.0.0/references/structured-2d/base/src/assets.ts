// Volute — the produced asset set (specs/assets.md).
//
// Every sprite, sheet frame, particle system and cue the game shows or plays was
// produced with the six asset tools, committed under `public/assets/`, and is
// loaded from there through the ENGINE'S OWN loaders. Vite copies `public/`
// into `dist/` unchanged and the engine resolves every path under its
// `assets/` root, which is relative to the page — so the built site runs from
// the root of a static host and from any sub-path of one alike. No tool runs at
// build time: `npm ci` and `npm run build` only copy these files.
//
// The decoded images, the parsed particle systems, and the cue names that
// arrived are NOT game state (specs/state.md): the simulation reaches the same
// state with them and without them. They are loaded once, by the game
// instance's `initialize`, and held here — the engine's own `assets.md` pattern
// for handing a loaded image to an actor that is constructed later, since an
// actor's constructor runs before it has a world.

import type { InitApi } from "@test-cabinet/structured-2d";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import { CHARGE_IDS, CUES, MACHINERY_KINDS } from "./constants";
import type { ChargeId, CueName, MachineryKind } from "./constants";

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

/** Everything the hall draws and plays, decoded. */
export interface VoluteAssets {
  /** One core sprite per charge, 28 x 28. */
  readonly cores: Readonly<Record<ChargeId, ImageBitmap>>;
  /** One mark badge per machinery kind, 16 x 16. */
  readonly marks: Readonly<Record<MachineryKind, ImageBitmap>>;
  /** The injector, the intake, and the channel tile. */
  readonly injectorBase: ImageBitmap;
  readonly injectorBarrel: ImageBitmap;
  readonly intakeMaw: ImageBitmap;
  readonly channelPlate: ImageBitmap;
  /** The two HUD icons, 24 x 24. */
  readonly cellIcon: ImageBitmap;
  readonly pressureIcon: ImageBitmap;
  /** The three sheets, frame by frame. */
  readonly sheets: Readonly<Record<SheetName, readonly ImageBitmap[]>>;
  /** The four produced particle systems, parsed. */
  readonly systems: Readonly<Record<SystemName, ParticleSystem>>;
  /** The cues whose produced file decoded, and so are playable. */
  readonly cues: ReadonlySet<CueName>;
}

/** What `loadAssets` produced, held for the actors constructed after it. */
let loaded: VoluteAssets | null = null;

/**
 * The produced set, or a thrown error naming the ordering.
 *
 * Every caller runs after the game instance's `initialize` has awaited
 * {@link loadAssets}, so the throw is a programming error rather than a missing
 * file.
 */
export function assets(): VoluteAssets {
  if (loaded === null) {
    throw new Error("Volute: the produced assets have not been loaded yet");
  }
  return loaded;
}

/** Whether a cue's produced file decoded, and so may be played. */
export function cueAvailable(cue: CueName): boolean {
  return loaded !== null && loaded.cues.has(cue);
}

/**
 * Load every produced file the game shows or plays, and hold it.
 *
 * A file that does not arrive is reported by the engine as `asset:failed` and
 * left out rather than failing the build: a hall with one missing sound still
 * plays, and the missing name is never played, so nothing throws downstream.
 */
export async function loadAssets(api: InitApi): Promise<VoluteAssets> {
  const [
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
    cues,
  ] = await Promise.all([
    loadKeyed(api, CHARGE_IDS, (charge) => `cores/${charge}.png`),
    loadKeyed(api, MACHINERY_KINDS, (kind) => `marks/${kind}.png`),
    api.assets.loadImage("machine/injector-base.png"),
    api.assets.loadImage("machine/injector-barrel.png"),
    api.assets.loadImage("machine/intake-maw.png"),
    api.assets.loadImage("machine/channel-plate.png"),
    api.assets.loadImage("hud/cell.png"),
    api.assets.loadImage("hud/pressure.png"),
    loadSheets(api),
    loadSystems(api),
    loadCues(api),
  ]);

  loaded = {
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
    cues,
  };
  return loaded;
}

/** One decoded image per member of `keys`, under the path each one names. */
async function loadKeyed<K extends string>(
  api: InitApi,
  keys: readonly K[],
  path: (key: K) => string,
): Promise<Record<K, ImageBitmap>> {
  const images = await Promise.all(
    keys.map((key) => api.assets.loadImage(path(key))),
  );
  const out = {} as Record<K, ImageBitmap>;
  keys.forEach((key, index) => {
    out[key] = images[index];
  });
  return out;
}

/** The three produced sheets, each frame a file of its own. */
async function loadSheets(
  api: InitApi,
): Promise<Record<SheetName, ImageBitmap[]>> {
  const names = Object.keys(SHEETS) as SheetName[];
  const sheets = await Promise.all(
    names.map((name) =>
      Promise.all(
        Array.from({ length: SHEETS[name] }, (_unused, frame) =>
          api.assets.loadImage(`sheets/${name}/${frame}.png`),
        ),
      ),
    ),
  );
  const out = {} as Record<SheetName, ImageBitmap[]>;
  names.forEach((name, index) => {
    out[name] = sheets[index];
  });
  return out;
}

/** The four produced particle systems, fetched as blobs and parsed. */
async function loadSystems(
  api: InitApi,
): Promise<Record<SystemName, ParticleSystem>> {
  const blobs = await Promise.all(
    PARTICLE_SYSTEMS.map((name) =>
      api.assets.load(`fx/${name}.system.json`).then((blob) => blob.text()),
    ),
  );
  const out = {} as Record<SystemName, ParticleSystem>;
  PARTICLE_SYSTEMS.forEach((name, index) => {
    out[name] = JSON.parse(blobs[index]) as ParticleSystem;
  });
  return out;
}

/**
 * Bind every cue name to its produced `.wav`, and report which arrived.
 *
 * `audio.load` binds the name only after the decode succeeds, so a name whose
 * file did not arrive stays undeclared — and playing an undeclared cue throws.
 * The set this returns is what {@link cueAvailable} guards every play with.
 */
async function loadCues(api: InitApi): Promise<Set<CueName>> {
  const names = Object.values(CUES);
  const results = await Promise.allSettled(
    names.map((cue) => api.audio.load(cue, `audio/${cue}.wav`)),
  );
  const available = new Set<CueName>();
  names.forEach((cue, index) => {
    if (results[index].status === "fulfilled") available.add(cue);
  });
  return available;
}
