// Deepcore — the figures `specs/assets.md` states about produced files that
// `src/constants.ts` does not already carry. CASE-PROVIDED.
//
// `src/constants.ts` is the case's own module, seeded into every workspace, and it
// already holds the produced-asset figures the SIMULATION shares with the contract
// — `ANIM_FPS`, `MINER_SPRITE`, `ICON_SIZE`, `TILE_VARIANTS`, `CRACK_FRAMES`, the
// four band names, the six building ids, the thirteen cue names. Everything below
// is the rest of the contract: the per-state frame minimums, the file-name sets,
// and the two counts `specs/assets.md` states in prose rather than as a named
// figure. Nothing here is taken from the reference implementation.

import {
  BANDS,
  BUILDINGS,
  CUES,
  GEMSTONE_IDS,
  MATERIALS,
  ORE_IDS,
  ROCKET_COMPONENTS,
} from "../../src/constants";
import type { BandName, MaterialId, OreId } from "../../src/constants";

/** How many variants unbreakable stone carries at least: "at least two variants". */
export const STONE_VARIANTS = 2;

/** How many frames the lava shimmer carries at least, to be a looping cycle at all. */
export const LAVA_FRAMES = 2;

/** How many different drawings a cycle carries at least, to be a cycle at all. */
export const DRAWINGS_MIN = 2;

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

/** The four bands' rock, by the file-name stem `assets/tiles/<band>-<n>.png` gives. */
export const BAND_TILES: readonly BandName[] = BANDS;

/** The six surface buildings, by the ids `specs/world.md` gives them. */
export const BUILDING_SPRITES: readonly string[] = BUILDINGS;

/** The rest of what `assets/surface/` holds. */
export const SURFACE_SPRITES: readonly string[] = [
  "cave-mouth",
  "ground",
  "sky",
];

/** The material sprites, the Core, and the Core Sample. */
export const MATERIAL_SPRITES: readonly (MaterialId | "core" | "core-sample")[] =
  [...MATERIALS, "core", "core-sample"];

/** The ten ores and the three gemstones, whose overlays are named in lower case. */
export const MINERAL_SPRITES: readonly OreId[] = [...ORE_IDS, ...GEMSTONE_IDS];

/** How many assembly states the rocket is produced at: `stage0` through `stage5`. */
export const ROCKET_STAGES = ROCKET_COMPONENTS.length + 1;

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

/** The thirteen produced sounds, by the cue names `specs/assets.md` files them under. */
export const AUDIO_FILES: readonly string[] = Object.values(CUES);
