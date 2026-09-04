// Deepcore — the figures `specs/assets.md` states about produced files.
// CASE-PROVIDED.
//
// `constants.ts` carries the figures the SIMULATION rests on. These are the ones
// the produced-asset contract rests on, and they are here rather than there for
// the same reason the points that use them are in one directory: nothing outside
// this category reads them. Every name and every number below is stated in
// `specs/assets.md`, and nothing here is taken from the reference implementation.

import type { Band, Material } from "../constants";

/** The frame rate a miner cycle is played at, `ANIM_FPS`. */
export const ANIM_FPS = 12;

/** The square a miner frame is authored to fit within, `MINER_SPRITE`. */
export const MINER_SPRITE = 80;

/** The square a status-bar icon is authored at, `ICON_SIZE`. */
export const ICON_SIZE = 24;

/** How many interchangeable rock variants a band carries at least, `TILE_VARIANTS`. */
export const TILE_VARIANTS = 3;

/** How many frames the drill-damage overlay carries at least, `CRACK_FRAMES`. */
export const CRACK_FRAMES = 4;

/** How many variants unbreakable stone carries at least. */
export const STONE_VARIANTS = 2;

/** How many frames the lava shimmer carries at least, to be a cycle at all. */
export const LAVA_FRAMES = 2;

/** The miner's animation states, and the frames `specs/assets.md` asks each for. */
export const MINER_CYCLES: Readonly<Record<string, number>> = {
  idle: 2,
  walk: 4,
  "drill-down": 3,
  "drill-side": 3,
  jetpack: 3,
  fall: 2,
  hurt: 2,
  "fuel-out": 2,
};

/** The four bands' rock, by the file-name stem `specs/assets.md` gives each. */
export const BAND_TILES: readonly Band[] = [
  "topsoil",
  "rockbed",
  "deepstone",
  "coreshell",
];

/** The six surface buildings, by the ids `specs/world.md` gives them. */
export const BUILDING_SPRITES: readonly string[] = [
  "fuel-depot",
  "ore-market",
  "save-pad",
  "upgrade-shop",
  "supply-depot",
  "launch-pad",
];

/** The rest of what `assets/surface/` holds. */
export const SURFACE_SPRITES: readonly string[] = [
  "cave-mouth",
  "ground",
  "sky",
];

/** The material sprites, the Core, and the Core Sample. */
export const MATERIAL_SPRITES: readonly (Material | "core" | "core-sample")[] =
  ["resonite", "cryenite", "core", "core-sample"];

/** How many assembly states the rocket is produced at: `stage0` through `stage5`. */
export const ROCKET_STAGES = 6;

/** The twelve produced particle systems, by the file names `specs/assets.md` gives. */
export const FX_SYSTEMS: readonly string[] = [
  "gas-seep",
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

/** The thirteen produced sounds, by the file names `specs/assets.md` gives. */
export const AUDIO_FILES: readonly string[] = [
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

/** The status-bar icons `specs/assets.md` asks for. */
export const ICON_SPRITES: readonly string[] = [
  "fuel",
  "hull",
  "cargo",
  "credits",
  "depth",
  "resonite",
  "cryenite",
];
