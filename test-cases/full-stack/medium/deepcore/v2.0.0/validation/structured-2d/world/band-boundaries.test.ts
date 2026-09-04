// world/band-boundaries — a row belongs to the band its depth fraction puts it in.
//
// `specs/world.md` divides the minable rows into four equal bands: "The band
// index of a minable row is `min(3, floor(4 * depthFraction(row)))`", over
// `depthFraction(row) = (row - 1) / (coreRow - 1)`. At the Standard size that
// makes rows `1`–`125` topsoil, `126`–`250` rockbed, `251`–`375` deepstone and
// `376`–`499` coreshell. Everything that varies with depth hangs off this: the
// health a cell starts at, which hazards generation places, which gemstone can
// be drawn, and how much a lava cut costs.
//
// WHAT IS READ, AND WHY IT IS READ ON POSED CELLS. `tileAt` reports the band of a
// cell, so the boundary is readable directly. The cells are posed rather than
// generated, so each reading is of a cell the check chose the row of: the two
// rows either side of each boundary, the first minable row, and the last. A
// generated mine would put whatever it liked at those rows.
//
// AND WHY IT IS READ AT TWO SIZES. The boundaries are a fraction of the mine's
// depth rather than fixed rows, so the same rule lands on different rows at
// different sizes. A build that hard-coded the Standard size's boundaries passes
// one reading and fails the other.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  bandAtFraction,
  captureStill,
  coreRowFor,
  createHarness,
  depthFraction,
  fillBlock,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  pinMiner,
  placeAt,
  type Harness,
} from "../harness";

const COL = 8;

/** The rows read at each size: the first, the last, and both sides of each boundary. */
function boundaryRows(coreRow: number): number[] {
  const rows = new Set<number>([1, coreRow - 1]);
  for (const index of [1, 2, 3]) {
    // The first row of band `index` is the shallowest whose fraction reaches
    // `index / 4`; the row above it is the last of the band before.
    const first = Math.ceil((index / 4) * (coreRow - 1)) + 1;
    rows.add(first - 1);
    rows.add(first);
  }
  return [...rows].sort((a, b) => a - b);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports each row in the band its depth fraction falls in", async () => {
  for (const size of ["standard", "quick"] as const) {
    openScene(h, { size });
    const coreRow = coreRowFor(size);
    for (const row of boundaryRows(coreRow)) {
      h.debug.setTile(COL, row, "rock");
      const tile = h.tileAt(COL, row);
      assertEqual(
        tile.band,
        bandAtFraction(depthFraction(row, coreRow)),
        `the band of row ${row} of ${coreRow} at the ${size} size`,
      );
    }
  }

  // The picture: rock either side of the rockbed's opening boundary, at the
  // Standard size, where the specification names the rows outright.
  openScene(h);
  const boundary = 126;
  fillBlock(
    h,
    {
      fromCol: COL - 3,
      toCol: COL + 3,
      fromRow: boundary - 4,
      toRow: boundary + 3,
    },
    "rock",
  );
  placeAt(h, minerXOn(COL), minerYOn(boundary - 4));
  pinMiner(h);
  pinDrill(h);
  await h.advance(2);
  captureStill(h, "bands");
});
