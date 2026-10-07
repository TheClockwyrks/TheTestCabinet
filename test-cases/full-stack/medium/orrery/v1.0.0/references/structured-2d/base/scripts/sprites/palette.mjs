// Orrery — the one palette every produced sprite is painted from.
//
// The mood specs/assets.md fixes is "a brass instrument under a night sky:
// worked metal, cut glass, and the cold light of the bodies the machine
// handles". So the machine — hubs, grippers, wheels, mounts, filaments, and
// the engraved sigils — is BRASS, in one warm ramp from a dark engraved
// shadow up to a polished highlight; the tape's instruction glyphs are the
// same brass cooled toward steel where an instruction belongs to a mechanism
// rather than a hand; and the motes alone carry saturated color, because they
// are the light in the scene.
//
// The values match `src/theme.ts`, which fixes what the build draws in code,
// so a produced sprite and the chrome around it read as one place.

import { rgba } from "./raster.mjs";

/** The brass ramp: engraved shadow, body, lit face, polished highlight. */
export const BRASS = {
  shadow: rgba("#3f2b0e"),
  dark: rgba("#6a4a1d"),
  mid: rgba("#a97a2f"),
  body: rgba("#c99340"),
  lit: rgba("#e8b661"),
  pale: rgba("#f6dca6"),
  high: rgba("#fff4dc"),
};

/** Cold worked metal, for a gripper's jaw and a set's cooler machinery. */
export const STEEL = {
  shadow: rgba("#1b2033"),
  dark: rgba("#3c4257"),
  mid: rgba("#6d7590"),
  lit: rgba("#a8b3cb"),
  pale: rgba("#cdd8ec"),
};

/** Cut glass and cold starlight. */
export const GLASS = {
  deep: rgba("#2b6f96"),
  mid: rgba("#4ec6f0"),
  lit: rgba("#9fe8ff"),
  pale: rgba("#e2f8ff"),
};

/** The dark the sprites are seen against; painted only as a bore or a maw. */
export const NIGHT = {
  sky: rgba("#080b16"),
  well: rgba("#0d0a18"),
  pit: rgba("#120a20"),
};

/** A refusal, a fault, and the halt: the one alarm color. */
export const FAULT = rgba("#e2664f");

/** Fire, and everything a rise pushes out into the field. */
export const EMBER = {
  deep: rgba("#b4501a"),
  mid: rgba("#ff7a1e"),
  lit: rgba("#ffb84a"),
  pale: rgba("#ffe2a8"),
};

/** The essence of cloud, and the violet half of the polarity pair. */
export const VIOLET = {
  deep: rgba("#4a2470"),
  mid: rgba("#8c4fd0"),
  lit: rgba("#c07ce8"),
  pale: rgba("#f2d8ff"),
};

/** The essence of stone: dead, unlit rock. */
export const STONE = {
  deep: rgba("#3f3a30"),
  mid: rgba("#7b7466"),
  lit: rgba("#a49b88"),
  pale: rgba("#cfc6ad"),
};
