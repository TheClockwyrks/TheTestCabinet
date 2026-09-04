// Deepcore — the look: the palette, the type, and the fill each band's rock reads
// as.
//
// `specs/overview.md` fixes what a player has to read at a glance and leaves the
// palette, the typography, and the layout to the build, so none of it is in
// `src/constants.ts` and all of it is here. Every color the game draws is named
// once below and referred to by name, so a change of mood is a change to this
// file alone.

import type { BandName, MaterialId, OreId } from "./constants";

/**
 * The whole palette. The mine runs dark and industrial from a dim sky, through
 * earth and gray rock, to a red-glowing shell around the core; the ores each
 * carry a hue of their own so the ten are told apart at a glance.
 */
export const PALETTE = {
  void: "#05070a",
  duskSky: "#1b2536",
  surfaceGround: "#2c2620",
  topsoilFill: "#3a2c1f",
  rockbedFill: "#3a3d44",
  deepstoneFill: "#20242c",
  coreshellFill: "#3a1512",
  coreGlow: "#ff6a2a",
  bedrock: "#0c0f14",
  tunnel: "#0a0d12",
  tunnelEdge: "#171b22",
  ferron: "#b8794a",
  marlite: "#b8a24e",
  cuprite: "#4fb0a0",
  argenite: "#cdd6e0",
  cobaltine: "#7b74c8",
  voltite: "#5a8cff",
  halcite: "#9fc63e",
  pyronium: "#ff8a3a",
  cindrite: "#e0472a",
  adamite: "#8affda",
  verdite: "#2fe36a",
  roselite: "#ff4f7a",
  aurite: "#ffca28",
  resonite: "#4ad0ff",
  cryenite: "#b98cff",
  coreSample: "#ff4a2a",
  gas: "#9ad24a",
  lava: "#ff5220",
  fuel: "#ffcf4a",
  hull: "#46d6e6",
  cargo: "#c48a52",
  credits: "#ffd23a",
  minerSuit: "#ffcf9a",
  jetpackFlame: "#ffa63a",
  alert: "#ff5a52",
  panel: "#141a20",
  textPrimary: "#e8eef5",
  textSecondary: "#93a2b2",
  textTertiary: "#5d6b7a",
} as const;

/** The rock fill a band is drawn over where its produced variants are missing. */
export const BAND_FILL: Readonly<Record<BandName, string>> = {
  topsoil: PALETTE.topsoilFill,
  rockbed: PALETTE.rockbedFill,
  deepstone: PALETTE.deepstoneFill,
  coreshell: PALETTE.coreshellFill,
};

/** The color a mineral's overlay and its inventory dot read as. */
export const MINERAL_COLOR: Readonly<Record<OreId, string>> = {
  ferron: PALETTE.ferron,
  marlite: PALETTE.marlite,
  cuprite: PALETTE.cuprite,
  argenite: PALETTE.argenite,
  cobaltine: PALETTE.cobaltine,
  voltite: PALETTE.voltite,
  halcite: PALETTE.halcite,
  pyronium: PALETTE.pyronium,
  cindrite: PALETTE.cindrite,
  adamite: PALETTE.adamite,
  verdite: PALETTE.verdite,
  roselite: PALETTE.roselite,
  aurite: PALETTE.aurite,
};

/** The color each exotic material reads as. */
export const MATERIAL_COLOR: Readonly<
  Record<MaterialId | "core-sample", string>
> = {
  resonite: PALETTE.resonite,
  cryenite: PALETTE.cryenite,
  "core-sample": PALETTE.coreSample,
};

/** A system monospace stack, so nothing is downloaded and the build runs offline. */
export const FONT_STACK =
  'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
