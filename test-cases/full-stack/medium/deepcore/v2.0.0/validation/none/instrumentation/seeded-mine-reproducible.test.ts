// instrumentation/seeded-mine-reproducible — a seed reproduces its mine.
//
// `specs/instrumentation.md`: "Seeded randomness. Every draw the game makes runs
// off a generator the surface's `reset` seeds, above all the mine's generation:
// the ore scatter, the hazard and boulder placement, and the two material nodes'
// cells. The game keeps that generator's whole state, so reseeding and replaying
// the same calls reproduces the same mine and the same outcome exactly."
//
// It is what makes every other point in this project reproducible. A generation
// check that measured a different mine each time it ran would report a build's
// density as whatever this morning's draw happened to be, and a failure a
// reviewer could not replay is a failure nobody can act on.
//
// WHAT IS COMPARED. The whole grid, cell for cell, read through the build's own
// `tileAt` — every kind, every ore a vein holds, and both material nodes' cells —
// rather than a sample of it, since the sentence says the mine reproduces exactly.
// Two mines from one seed have to agree; a mine from another seed has to differ,
// which is what separates a seeded generator from one that ignores its seed
// altogether and lays the same mine every time.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { look, scanMine, type MineScan } from "../generation/mine-scan";

/** Two seeds, and the size their mines are generated at. */
const SEED = 12;
const OTHER_SEED = 13;

let h: Harness;

/** Reset to `seed`, generate, and read the whole grid back. */
async function mineFrom(seed: number): Promise<MineScan> {
  await h.debug.setAutoStep(false);
  await h.debug.reset({ seed });
  await h.debug.generateMine();
  return scanMine(h);
}

/** One mine as a single comparable value: its kinds, its ores, its nodes. */
function fingerprint(scan: MineScan): string {
  return JSON.stringify([scan.rows, scan.ores, scan.materials]);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("generates the same mine twice from one seed, and a different one from another", async () => {
  const first = await mineFrom(SEED);
  const again = await mineFrom(SEED);

  assertDeepEqual(
    again.rows,
    first.rows,
    `the grid of the mine on seed ${SEED}`,
  );
  assertDeepEqual(again.ores, first.ores, `the ore scatter on seed ${SEED}`);
  assertDeepEqual(
    again.materials,
    first.materials,
    `the material nodes on seed ${SEED}`,
  );

  const other = await mineFrom(OTHER_SEED);
  assertNotEqual(
    fingerprint(other),
    fingerprint(first),
    `the mine on seed ${OTHER_SEED} against the one on seed ${SEED}`,
  );

  // The picture: the mine the seed reproduces.
  await h.debug.setScreen("in-mine");
  await look(h, 8, 120);
  await captureStill(h, "mine");
});
