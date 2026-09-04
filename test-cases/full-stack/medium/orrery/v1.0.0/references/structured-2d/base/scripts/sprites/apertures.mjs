// Orrery — the two aperture sheets (specs/assets.md "The sheets").
//
//   assets/sprites/apertures/rise/{0..5}.png   48 x 48, six frames
//   assets/sprites/apertures/set/{0..5}.png    48 x 48, six frames
//
// Each is emitted as SEPARATE numbered PNGs rather than as regions of one
// image, and each rise and set on the field shows frame
// `floor(simTime / APERTURE_FRAME_TIME) mod APERTURE_FRAMES` of its own sheet,
// so both apertures turn continuously for as long as the game runs.
//
// The turn is authored rather than redrawn: each sheet is two layers painted
// ONCE — an outer ring of six blades and an inner iris — and the tool spins
// them with keyframes, the blades one way and the iris the other, so the
// mechanism reads as geared. Both layers carry SIX-FOLD rotational symmetry
// and each frame advances 10 degrees, so frame 5 lands 50 degrees on and frame
// 5 into frame 0 closes the remaining 10: the six frames are six distinct
// rasters that come round into one continuous turn rather than a flicker.
//
// What separates the two is direction of travel and temperature. The RISE is
// an entrance: warm brass blades with their chevrons pointing OUT, around an
// iris of fire opening onto the field. The SET is an exit: cold steel blades
// with their chevrons pointing IN, around a dark maw with teeth. Neither is
// ever mistaken for the other, and frame `i` of one is never frame `i` of the
// other.

import { Raster, faded, polar, rgba } from "./raster.mjs";
import { BRASS, EMBER, NIGHT, STEEL, VIOLET } from "./palette.mjs";

/** APERTURE_SPRITE_SIZE. */
export const SIZE = 48;
/** APERTURE_FRAMES. */
export const FRAMES = 6;
/** The degrees one frame advances; six of them close the 60-degree period. */
export const STEP = 10;
const C = SIZE / 2;

/** The blade ring: six vanes, chevroned along or against the flow. */
function blades(tone, outward) {
  const g = new Raster(SIZE, SIZE);
  for (let i = 0; i < 6; i += 1) {
    const base = i * 60;
    g.sector(C, C, 21, 12.6, base + 3, base + 52, tone.edge);
    g.sector(C, C, 20, 13.6, base + 5, base + 49, tone.body);
    // The vane's lit leading edge, which is what makes the turn read.
    g.sector(C, C, 20, 17.6, base + 5, base + 49, tone.lit);
    // The chevron, cut into the vane and pointing the way the aperture works.
    const mid = base + 27;
    const [tipX, tipY] = polar(C, C, outward ? 20.4 : 13.4, mid);
    const heading = outward ? mid : mid + 180;
    g.arrowhead(tipX, tipY, heading, 6.6, 40, tone.edge);
    g.arrowhead(tipX, tipY, heading, 5, 38, tone.mark);
  }
  return g;
}

/** The rise's iris: six petals of fire opening onto the field. */
function riseIris() {
  const g = new Raster(SIZE, SIZE);
  g.disc(C, C, 11.4, faded(EMBER.deep, 0.5));
  for (let i = 0; i < 6; i += 1) {
    const base = i * 60;
    g.poly(
      [
        polar(C, C, 3.4, base + 30),
        polar(C, C, 11.6, base + 6),
        polar(C, C, 11.6, base + 54),
      ],
      EMBER.mid,
    );
    g.poly(
      [
        polar(C, C, 2.6, base + 30),
        polar(C, C, 8.6, base + 14),
        polar(C, C, 8.6, base + 46),
      ],
      EMBER.lit,
    );
  }
  g.disc(C, C, 4.4, EMBER.pale);
  g.disc(C, C, 2.4, rgba("#fffdf2"));
  return g;
}

/** The set's maw: a dark well ringed with teeth that face inward. */
function setMaw() {
  const g = new Raster(SIZE, SIZE);
  g.disc(C, C, 11.6, STEEL.shadow);
  g.disc(C, C, 10.4, NIGHT.pit);
  g.disc(C, C, 6.4, rgba("#05040c"));
  g.sector(C, C, 11.6, 10.2, -180, 180, faded(VIOLET.mid, 0.7));
  for (let i = 0; i < 6; i += 1) {
    const base = i * 60;
    g.poly(
      [
        polar(C, C, 4.6, base + 30),
        polar(C, C, 11.2, base + 12),
        polar(C, C, 11.2, base + 48),
      ],
      STEEL.mid,
    );
    g.poly(
      [
        polar(C, C, 5.6, base + 30),
        polar(C, C, 10, base + 18),
        polar(C, C, 10, base + 42),
      ],
      STEEL.dark,
    );
  }
  g.disc(C, C, 3, rgba("#03020a"));
  return g;
}

/** The rise sheet's two layers, painted once and spun by the tool. */
export const RISE = {
  blades: () =>
    blades(
      {
        edge: BRASS.shadow,
        body: BRASS.mid,
        lit: BRASS.lit,
        mark: BRASS.high,
      },
      true,
    ),
  iris: riseIris,
  /** The blades lead, so the ring turns clockwise and the iris against it. */
  bladeTurn: 1,
};

/** The set sheet's two layers. */
export const SET = {
  blades: () =>
    blades(
      {
        edge: STEEL.shadow,
        body: STEEL.mid,
        lit: STEEL.pale,
        mark: rgba("#eef4ff"),
      },
      false,
    ),
  iris: setMaw,
  /** The set turns the other way, so an exit never reads as an entrance. */
  bladeTurn: -1,
};
