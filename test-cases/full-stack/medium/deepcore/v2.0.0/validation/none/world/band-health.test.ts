// world/band-health — every minable cell starts at its band's health.
//
// `specs/world.md` gives each band a `BAND_HEALTH` — `4` in the topsoil, `8` in
// the rockbed, `12` in the deepstone, `16` in the coreshell — and says it is "the
// health of every minable tile in the band, which the drill removes in
// damage-per-hit chunks, so a deeper band takes more hits, and so more time and
// more fuel, to break". `specs/character.md` derives the hits to break a cell
// from it, and `specs/upgrades.md` tabulates those hits per drill tier, so the
// whole cost of digging rests on this figure.
//
// Both ways a cell comes into existence are read. A cell generation laid, taken
// from a real mine at each depth; and a cell a pose laid, which
// `specs/instrumentation.md` requires `setTile` to leave "at that band's full
// health". Each is read as `maxHealth` equal to the band's figure and `health`
// equal to `maxHealth`, since an untouched cell is a whole one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import {
  BAND_HEALTH,
  BAND_ORDER,
  MINABLE_TILE_KINDS,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
} from "../constants";
import {
  captureStill,
  createHarness,
  openScene,
  type Harness,
} from "../harness";
import {
  bandRows,
  generatedMine,
  kindAt,
  look,
  type MineScan,
} from "../generation/mine-scan";

const COL = 8;

/** A minable cell generation laid inside `band`, or `null` where it laid none. */
function minableCellIn(
  scan: MineScan,
  band: (typeof BAND_ORDER)[number],
): { col: number; row: number } | null {
  const { from, to } = bandRows(scan.coreRow)[band];
  for (let row = from; row <= to; row += 1) {
    for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col += 1) {
      const kind = kindAt(scan, col, row);
      if (kind !== null && MINABLE_TILE_KINDS.includes(kind)) {
        return { col, row };
      }
    }
  }
  return null;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts every minable cell at 4, 8, 12 and 16 health by band", async () => {
  // A posed cell, at each band's midpoint.
  await openScene(h);
  const spans = bandRows((await h.snapshot()).coreRow);
  for (const band of BAND_ORDER) {
    const row = Math.round((spans[band].from + spans[band].to) / 2);
    await h.debug.setTile(COL, row, "rock");
    const tile = await h.tileAt(COL, row);
    assertEqual(
      tile.maxHealth,
      BAND_HEALTH[band],
      `the posed ${band} cell's maxHealth`,
    );
    assertEqual(
      tile.health,
      BAND_HEALTH[band],
      `the posed ${band} cell's health`,
    );
  }

  // And a cell generation laid, at each band.
  const scan = await generatedMine(h, 1);
  for (const band of BAND_ORDER) {
    const cell = minableCellIn(scan, band);
    if (cell === null) {
      fail(`a minable cell in the generated ${band}`, "the band held none");
    }
    const tile = await h.tileAt(cell.col, cell.row);
    assertEqual(
      tile.maxHealth,
      BAND_HEALTH[band],
      `the generated ${band} cell at (${cell.col}, ${cell.row})`,
    );
    assertEqual(
      tile.health,
      tile.maxHealth,
      `the generated ${band} cell's untouched health`,
    );
  }

  // The picture: the coreshell, whose cells take four times the topsoil's work.
  const coreshell = spans.coreshell;
  await look(h, COL, Math.round((coreshell.from + coreshell.to) / 2));
  await captureStill(h, "health");
});
