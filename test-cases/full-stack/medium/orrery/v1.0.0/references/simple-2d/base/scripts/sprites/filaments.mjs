// Orrery — the two filament strips (specs/assets.md "The sprites").
//
// A filament joins motes on adjacent hexes, and a constellation is rigid, so
// the strip spans exactly HEX_PITCH (48) at every moment and is drawn at
// native size: 48 x 16, centered on the midpoint between the two mote centers
// and turned to the angle from the first to the second. The motes are drawn
// OVER its ends, so the ends are collars rather than detail.
//
// The bar specs/field.md sets is that the triune strip reads as clearly
// heavier than the plain one at a glance. The plain strip is one drawn brass
// wire; the triune is three wires bound by four collars into a cable more than
// three times as deep, which is the difference read across a whole field.

import { Raster, faded } from "./raster.mjs";
import { BRASS } from "./palette.mjs";

/** The strip canvas, FILAMENT_SPRITE_W x FILAMENT_SPRITE_H. */
export const W = 48;
export const H = 16;
const MID = H / 2;

/** One brass wire along the strip: shadow, body, and a lit top edge. */
function wire(g, y, thickness, x0 = 0, x1 = W) {
  g.rect(x0, y - thickness / 2, x1 - x0, thickness + 1, BRASS.shadow);
  g.rect(x0, y - thickness / 2, x1 - x0, thickness, BRASS.mid);
  g.rect(x0, y - thickness / 2, x1 - x0, 1, BRASS.pale);
}

/** A collar clamped across the cable, which is what makes it read as bound. */
function collar(g, x, halfHeight, width) {
  g.rect(x - width / 2, MID - halfHeight, width, halfHeight * 2, BRASS.dark);
  g.rect(x - width / 2, MID - halfHeight, width, 1, BRASS.lit);
  g.rect(x - width / 2, MID + halfHeight - 1, width, 1, BRASS.shadow);
  g.rect(
    x - width / 2 + 1,
    MID - halfHeight + 1,
    1,
    halfHeight * 2 - 2,
    BRASS.high,
  );
}

/** The plain strip: a single weight-1 wire between two end collars. */
export function plain() {
  const g = new Raster(W, H);
  wire(g, MID, 3, 1, W - 1);
  // A drawn taper: the wire is thinnest at the middle of its span.
  g.rect(2, MID - 1, W - 4, 1, BRASS.lit);
  g.rect(18, MID - 1, 12, 1, BRASS.body);
  collar(g, 2.5, 4, 5);
  collar(g, W - 2.5, 4, 5);
  return g;
}

/** The triune strip: three wires bound by four collars — visibly a cable. */
export function triune() {
  const g = new Raster(W, H);
  // The bed the three wires are laid in, so the cable has one silhouette.
  g.rect(1, MID - 6, W - 2, 12, faded(BRASS.shadow, 0.85));
  wire(g, MID - 4, 3, 1, W - 1);
  wire(g, MID, 3, 1, W - 1);
  wire(g, MID + 4, 3, 1, W - 1);
  g.rect(1, MID - 5, W - 2, 1, BRASS.lit);
  g.rect(1, MID + 5, W - 2, 1, BRASS.dark);
  for (const x of [9, 21, 33]) collar(g, x, 7, 4);
  collar(g, 3, 7.5, 6);
  collar(g, W - 3, 7.5, 6);
  // Three rivet heads down the center collar, the tell at a glance.
  for (const y of [MID - 4, MID, MID + 4]) {
    g.disc(21, y, 1.2, BRASS.high);
  }
  return g;
}
