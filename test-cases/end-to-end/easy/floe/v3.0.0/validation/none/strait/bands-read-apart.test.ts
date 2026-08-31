// strait/bands-read-apart — a player can tell the five bands apart at a glance.
//
// specs/overview.md's visual-design table: "The near shore, the ice band, the
// median shelf, the water band, and the far shore are told apart at a glance, and
// the two solid safe strips read as safe against the two crossing zones on either
// side." specs/strait.md names the rows each band occupies, and this point reads
// one row of each and holds all ten pairs apart.
//
// WHAT IS READ IS A DISTANCE, NEVER A COLOUR. Floe fixes no palette — the look is
// the build's — so every reading here is between two things the BUILD drew, and
// no hex value, hue or channel is asserted. What the point fixes is how far apart
// two of them must be.
//
// SAMPLED ACROSS THE FULL WIDTH OF EACH BAND. `sampleRow` averages five columns
// spread along the row, so a build that textures, shades or drifts one band is
// read on the band rather than on one tile of it, and no single feature dominates.
//
// THE STRAIT IS EMPTIED AND THE CRITTER TAKEN OFF IT, because what is graded is
// the BAND. A vehicle parked on an ice row, a floe on a water row or the critter
// standing on the near shore would each be read into the average of the band it
// sits on, and this point would then be grading the traffic.
//
// WHICH ROW STANDS FOR EACH BAND, AND WHY THE FAR SHORE IS READ ON ROW `0`. The
// near shore and the median are one row each. The two crossing bands are read on
// a row in the middle of each, away from both of their boundaries, so the reading
// is of the band and not of a seam with its neighbour. The far shore is TWO rows
// — the bay row `1` and the cap `0` — and the bay row is cut by five two-column
// mouths; the five columns `sampleRow` reads (`4`, `12`, `20`, `28`, `36`) are
// every one of them inside a bay, so a reading of row `1` would be a reading of
// the five bays rather than of the shore. Row `0` is "solid far shore, full
// width" (specs/strait.md), so that is where the far shore is read. What an open
// bay must read apart from is `strait/bays-read-apart`, its own item.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThanOrEqual } from "../assert";
import { ROW_CAP, ROW_MEDIAN, ROW_NEAR } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  sampleRow,
  startCrossing,
  type Harness,
  type Rgb,
} from "../harness";

/**
 * How far apart two bands must read, as an RGB distance out of about `441`.
 *
 * The item's own figure. The RGB cube's longest diagonal is about `441`, so `40`
 * is a little under a tenth of the whole range: comfortably above the shading,
 * texture or gradient a build may give one band — measured over five columns
 * spread along a row, a textured band's own variation is a few units — and well
 * below what two surfaces a player must "tell apart at a glance" measure against
 * each other. It is lower than the `60` the bodies and the bays are held to
 * (`presentation/critter-reads-apart`, `strait/bays-read-apart`) because a band
 * is a large flat expanse read against a neighbouring expanse, where a small
 * separation is legible, while a body is a 32-unit sprite that has to be picked
 * out of the band under it.
 */
const BANDS_APART_MIN = 40;

/**
 * A row in the middle of the ice band and one in the middle of the water band.
 *
 * The ice band is rows `11`-`18` and the water band rows `2`-`9`
 * (specs/strait.md); `14` and `5` sit three rows from one boundary and four from
 * the other, so neither reading is taken at a seam with a neighbouring band.
 */
const ICE_ROW = 14;
const WATER_ROW = 5;

/** The five bands, each with the row it is read on. */
const BANDS: readonly { name: string; row: number }[] = [
  { name: "the near shore", row: ROW_NEAR },
  { name: "the ice band", row: ICE_ROW },
  { name: "the median shelf", row: ROW_MEDIAN },
  { name: "the water band", row: WATER_ROW },
  { name: "the far shore", row: ROW_CAP },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the five bands in tints each read apart from the other four", async () => {
  // An emptied, live strait with nothing on it at all: no vehicle, no floe, no
  // bear, no bonus catch, and no critter.
  await startCrossing(h);
  await h.debug.removeCritter();
  await h.step();

  // Before the readings, so a failing verdict leaves the strait that was read.
  await captureStill(h, "scene");

  const read: Rgb[] = [];
  for (const band of BANDS) read.push(await sampleRow(h, band.row));

  for (let a = 0; a < BANDS.length; a += 1) {
    for (let b = a + 1; b < BANDS.length; b += 1) {
      assertGreaterThanOrEqual(
        colorDistance(read[a], read[b]),
        BANDS_APART_MIN,
        `${BANDS[a].name} (row ${BANDS[a].row}) read against ` +
          `${BANDS[b].name} (row ${BANDS[b].row}), each sampled across the ` +
          `full width of its row — the five bands are told apart at a glance ` +
          `(specs/overview.md)`,
      );
    }
  }

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(h.pageErrors, []);
});
