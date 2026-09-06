// generation/gemstone-band-confinement — each gemstone stays in its own band.
//
// `specs/mining.md` gives the three gemstones curves narrow enough to confine
// each to one band: Verdite `peak 0.375, spread 0.125`, Roselite
// `peak 0.625, spread 0.125`, Aurite `peak 0.875, spread 0.125`. A draw is taken
// over `pick * max(0, 1 - abs(f - peak) / spread)`, so Verdite's weight is
// positive only for `f` strictly inside `(0.25, 0.5)`, which is exactly the
// rockbed; Roselite's inside `(0.5, 0.75)`, the deepstone; Aurite's inside
// `(0.75, 1)`, the coreshell. `specs/world.md` names the same pairing in its band
// table.
//
// So a gemstone found outside its band is a mine whose ore draw does not follow
// the curves, and this reads exactly that: every gemstone cell of a generated
// mine, and the band its row falls in.

import { afterEach, beforeEach, it } from "vitest";
import { GEMSTONE_IDS, MATERIAL_BAND } from "../constants";
import { assertDeepEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  type Band,
  type Harness,
} from "../harness";
import { bandOf, bandRows, generatedMine, look } from "./mine-scan";

const MINES = 6;

/** The band each gemstone's curve confines it to, from its peak and spread. */
const GEM_BAND: Readonly<Record<string, Band>> = {
  verdite: "rockbed",
  roselite: "deepstone",
  aurite: "coreshell",
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("finds Verdite only in the rockbed, Roselite only in the deepstone and Aurite only in the coreshell", async () => {
  let found = 0;
  let seen: { col: number; row: number } | null = null;
  for (let mine = 1; mine <= MINES; mine += 1) {
    const scan = generatedMine(h);
    // Cleared each mine, so what the picture is taken of is a cell of the mine
    // the engine is left holding rather than one an earlier mine held.
    seen = null;
    const stray: string[] = [];
    for (const cell of scan.ores) {
      if (!(GEMSTONE_IDS as readonly string[]).includes(cell.ore)) continue;
      found += 1;
      const band = bandOf(scan, cell.row);
      if (band !== GEM_BAND[cell.ore]) {
        stray.push(`${cell.ore} at row ${cell.row}, in the ${band}`);
      } else if (cell.ore === "roselite") {
        seen = { col: cell.col, row: cell.row };
      }
    }
    assertDeepEqual(stray.slice(0, 5), [], `generation ${mine}`);
  }

  // A rule that no gemstone was generated at all would satisfy vacuously, so the
  // mines read have to have held some: `specs/mining.md` puts each under one
  // percent of its band's cells, which over six mines is still hundreds.
  assertGreaterThan(found, 0, "gemstones found across the mines read");

  // The picture: one gemstone in its own band.
  const deepstone = bandRows(h.snapshot().coreRow)[MATERIAL_BAND.cryenite];
  await look(
    h,
    seen?.col ?? 16,
    seen?.row ?? Math.round((deepstone.from + deepstone.to) / 2),
  );
  captureStill(h, "gem");
});
