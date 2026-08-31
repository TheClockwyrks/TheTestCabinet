// strait/bands-read-apart — the five bands render in five tints a player tells
// apart at a glance.
//
// specs/overview.md's legibility table states the requirement: "The near shore,
// the ice band, the median shelf, the water band, and the far shore are told
// apart at a glance, and the two solid safe strips read as safe against the two
// crossing zones on either side." The palette itself is the build's — "The
// strait is yours to design" — so what is read here is separation and nothing
// about which colours were chosen.
//
// FORTY OF 441 is the item's own reading of "at a glance", and it is a modest
// one: 441 is the whole diagonal of the RGB cube, so forty is under a tenth of
// it — roughly a difference of twenty-three in each of the three channels, which
// is a tint a player sees rather than a shade they have to hunt for. A build
// that painted two bands the same colour reads zero, and a build that separated
// them with texture alone rather than tint reads close to it.
//
// SAMPLED ACROSS THE FULL WIDTH OF EACH, at eight columns spread over the forty,
// and down every row a band owns, so a band's tint is what the band actually
// looks like rather than what one lucky tile does. The two multi-row bands are
// read on all eight of their rows: a build that shaded its ice band from top to
// bottom is read on the whole gradient rather than on the end that happens to
// sit next to the median.
//
// THE FAR SHORE IS READ ON THE CAP, row `0`. specs/strait.md gives the far shore
// two rows, `0` and `1`, and row `1` is cut by the five bays — which the very
// next item, `bays-read-apart`, requires to render DIFFERENTLY from the shore
// around them. Reading the far shore on the row that is solid across its whole
// width keeps the two points apart: this one grades the band, that one grades
// the openings in it.
//
// THE STRAIT IS EMPTY AND THE CRITTER IS OFF IT, because every one of those
// bodies would be read as the band it stands on. `startCrossing` clears the two
// rosters, the bears and the bonus catch; the critter is the one body it puts
// there, and it is removed. What is left on the canvas is the strait itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import {
  ICE_BOTTOM,
  ICE_TOP,
  ROW_CAP,
  ROW_MEDIAN,
  ROW_NEAR,
  WATER_BOTTOM,
  WATER_TOP,
} from "../../src/constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  sampleTile,
  startCrossing,
  type Harness,
  type Rgb,
} from "../harness";

/**
 * The separation the item requires between any two of the five bands, of the
 * 441 an RGB distance runs to.
 */
const BAND_MIN = 40;

/** The rows from `from` to `to`, ascending. */
function rows(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_unused, i) => from + i);
}

/**
 * The eight columns every band is sampled on, spread across the forty.
 *
 * Every fifth column from `2`, so the sample reaches within two tiles of both
 * edges and lands on no repeating position of a build's own tiling.
 */
const COLUMNS: readonly number[] = [2, 7, 12, 17, 22, 27, 32, 37];

/** The five bands specs/strait.md names, and the rows each one owns. */
const BANDS: readonly { name: string; rows: readonly number[] }[] = [
  { name: "the near shore", rows: [ROW_NEAR] },
  { name: "the ice band", rows: rows(ICE_TOP, ICE_BOTTOM) },
  { name: "the median shelf", rows: [ROW_MEDIAN] },
  { name: "the water band", rows: rows(WATER_TOP, WATER_BOTTOM) },
  { name: "the far shore", rows: [ROW_CAP] },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** A band's tint: the mean of every tile sampled across it. */
function bandTint(band: { rows: readonly number[] }): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let taken = 0;
  for (const row of band.rows) {
    for (const col of COLUMNS) {
      const sample = sampleTile(h, col, row);
      r += sample.r;
      g += sample.g;
      b += sample.b;
      taken += 1;
    }
  }
  return { r: r / taken, g: g / taken, b: b / taken };
}

it("renders the five bands in tints each separated from the others", async () => {
  startCrossing(h);
  h.debug.removeCritter();
  await h.advance(1);
  captureStill(h, "scene");

  const tints = BANDS.map((band) => ({
    name: band.name,
    tint: bandTint(band),
  }));

  for (let i = 0; i < tints.length; i += 1) {
    for (let j = i + 1; j < tints.length; j += 1) {
      assertGreaterThanOrEqual(
        colorDistance(tints[i].tint, tints[j].tint),
        BAND_MIN,
        `${tints[i].name} against ${tints[j].name}: how far their tints sit ` +
          `apart, of 441 (specs/overview.md)`,
      );
    }
  }
});
