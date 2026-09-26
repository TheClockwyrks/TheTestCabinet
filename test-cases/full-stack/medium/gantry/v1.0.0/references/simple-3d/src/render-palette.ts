// The look: every colour, weight, and type face the yard and its readouts are
// drawn in, and the utilization ramp the members are coloured on.
//
// `src/constants.ts` deliberately holds no palette — `specs/overview.md` leaves
// the art direction to the build and states only what a player must read at a
// glance. This module is that art direction, in one place, so the 3D scene the
// engine renders and the 2D screen layer it composites over cannot drift apart.
//
// Gantry's yard is a working construction site under a clear, cool sky: packed
// warm earth underfoot, cold galvanised steel above it, and safety orange
// reserved for the things the player is being asked to act on — pads, the
// pending node, and a refusal.

import { CREAK_THRESHOLD } from "./constants";

/** A colour as `0xrrggbb`, which is what `three` takes. */
export type Hex = number;

/** The sky dome, from the horizon haze up to the zenith. */
export const SKY_HORIZON: Hex = 0xc4dae7;
export const SKY_ZENITH: Hex = 0x1d3a63;

/**
 * The stage background: the colour the engine clears the whole canvas to each
 * frame, letterbox bars included, so the bars match the yard rather than the
 * page. `src/game.ts` re-exports it under the name `src/main.ts` hands over.
 */
export const BACKGROUND = "#080b10";

/** The yard floor, its far apron, and the survey grid ruled over it. */
export const GROUND: Hex = 0x6f6553;
export const GROUND_FAR: Hex = 0x574f42;
export const GROUND_GRID: Hex = 0x8a8069;

/** The light: a cool sky bounce, a warm sun, and the sun's own colour. */
export const LIGHT_SKY: Hex = 0xbcd6ea;
export const LIGHT_GROUND: Hex = 0x6b5f4c;
export const LIGHT_SUN: Hex = 0xfff2dc;

/** The build aids: the envelope's extent, the lattice, and the two markers. */
export const ENVELOPE: Hex = 0x4fd6c4;
export const LATTICE: Hex = 0xdce8f2;
export const PICK_NODE: Hex = 0x8ff0ff;
export const PENDING_NODE: Hex = 0xffa524;

/** A site's fixtures: the anchor plates, the pads, and the obstacles. */
export const ANCHOR_PLATE: Hex = 0x9aa6b2;
export const PAD: Hex = 0xffb020;
export const OBSTACLE: Hex = 0x3d4750;
export const OBSTACLE_EDGE: Hex = 0xe0a020;

/** The members at rest, before a run or a check has anything to say. */
export const STRUT: Hex = 0xb4c0cc;
export const RAIL: Hex = 0x8d98a4;
export const RAIL_HEAD: Hex = 0xdbe4ec;
export const CABLE: Hex = 0xe7e0d0;
/** The hoist cable, which is rigging rather than structure. */
export const HOIST_CABLE: Hex = 0xf2ead9;
/** A member that has broken: charred, thin, and plainly not carrying. */
export const BROKEN: Hex = 0x53372f;
/** The same charred colour on the screen layer's legend. */
export const BROKEN_CSS = "#53372f";

/**
 * The utilization ramp (`specs/overview.md`): a monotone climb from slack steel
 * through olive, amber, and orange to red.
 *
 * What climbs monotonically is the ramp's heat, `r - (g + b) / 2`: it rises at
 * every stop and, since it is linear in the channels, at every point between
 * two stops as well. So a member reads hotter than one carrying less, whatever
 * pair you hold up beside each other.
 *
 * Past its limit a member leaves the ramp for white hot and pulses, which is
 * how a member at breaking point stands out from every member below it rather
 * than being the last shade of one gradient (`specs/overview.md`).
 */
const RAMP: readonly (readonly [number, Hex])[] = [
  [0.0, 0x6f8fa8],
  [0.35, 0xa8bf6a],
  [0.6, 0xdcc247],
  [CREAK_THRESHOLD, 0xef8b2c],
  [1.0, 0xe1362a],
];

/** Past its limit a member is white hot, whatever else the ramp would say. */
export const OVER_LIMIT: Hex = 0xfff0d8;

const channel = (colour: Hex, shift: number): number =>
  (colour >> shift) & 0xff;

const mix = (a: Hex, b: Hex, t: number): Hex => {
  const lerp = (shift: number): number =>
    Math.round(channel(a, shift) + (channel(b, shift) - channel(a, shift)) * t);
  return (lerp(16) << 16) | (lerp(8) << 8) | lerp(0);
};

/**
 * The colour a utilization reads as. Below `0` it clamps to the slack end, and
 * anything above `1` — which is a member past breaking point — is white hot.
 */
export function utilizationColour(utilization: number): Hex {
  if (!Number.isFinite(utilization)) return OVER_LIMIT;
  if (utilization > 1) return OVER_LIMIT;
  if (utilization <= RAMP[0][0]) return RAMP[0][1];
  for (let i = 1; i < RAMP.length; i++) {
    const [stopValue, stopColour] = RAMP[i];
    if (utilization <= stopValue) {
      const [prevValue, prevColour] = RAMP[i - 1];
      const span = stopValue - prevValue;
      const t = span === 0 ? 0 : (utilization - prevValue) / span;
      return mix(prevColour, stopColour, t);
    }
  }
  return RAMP[RAMP.length - 1][1];
}

/** A colour lifted toward white, for a machined face catching the light. */
export const lighten = (colour: Hex, amount: number): Hex =>
  mix(colour, 0xffffff, Math.max(0, Math.min(1, amount)));

/** The same colour as a CSS string, for the legend on the screen layer. */
export const css = (colour: Hex): string =>
  `#${colour.toString(16).padStart(6, "0")}`;

/** The colour a member of a material is drawn in when nothing has solved it. */
export const materialColour = (material: string): Hex =>
  material === "cable" ? CABLE : material === "rail" ? RAIL : STRUT;

// ---- The screen layer ------------------------------------------------------

/** Ink, from the brightest heading down to the faintest label. */
export const INK = "#eaf1f7";
export const INK_DIM = "#9fb2c2";
export const INK_FAINT = "#6c7f8f";

/** The accents the readouts speak in. */
export const ACCENT = "#ffb020";
export const GOOD = "#5ad18a";
export const BAD = "#ff6b52";
export const COOL = "#7fd4e8";

/** The panels the readouts sit on, so text is legible against the scene. */
export const PANEL = "rgba(9, 15, 21, 0.78)";
export const PANEL_SOLID = "rgba(9, 15, 21, 0.94)";
export const PANEL_EDGE = "rgba(233, 241, 247, 0.16)";
export const PANEL_INSET = "rgba(233, 241, 247, 0.06)";
/** The scrim a menu screen lays over the yard so its copy reads. */
export const SCRIM = "rgba(6, 10, 15, 0.72)";
/** The bar that fills as a crane's cost approaches the site's budget. */
export const GAUGE_TRACK = "rgba(233, 241, 247, 0.14)";

/** The type. Both stacks are generic, so the build ships no font file. */
export const DISPLAY_FONT =
  '"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif';
export const MONO_FONT =
  'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** A weight and a size in the display face. */
export const display = (size: number, weight = 700): string =>
  `${weight} ${size}px ${DISPLAY_FONT}`;

/** A weight and a size in the mono face, which every readout is set in. */
export const mono = (size: number, weight = 400): string =>
  `${weight} ${size}px ${MONO_FONT}`;
