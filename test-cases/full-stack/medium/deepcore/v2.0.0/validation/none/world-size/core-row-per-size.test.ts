// world-size/core-row-per-size — the Core sits at the depth the chosen size
// fixes.
//
// specs/world.md: `coreRow` is `round(STANDARD_ROWS * WORLD_SIZE_SCALE)`, which
// is 250 at Quick, 500 at Standard and 1000 at Marathon, and the Core chamber is
// that row with the Core tile at `CORE_COL` (16). Depth is reported in meters at
// `METERS_PER_ROW` (5) per row, so the foot of the Core chamber reads 1250, 2500
// and 5000 meters — the three depths `size-select` states.
//
// THREE READINGS PER SIZE, AND THEY ARE THE SAME CLAIM FROM THREE SIDES: the
// `coreRow` the snapshot reports, the Core tile standing at `(CORE_COL, coreRow)`
// where the specification puts it, and the depth in meters a miner at the foot of
// that chamber reads.
//
// ISOLATION. An empty mine at each size, with the miner's body gated so the pose
// at the bottom of the world holds where it was put, and its drill gated so
// nothing cuts.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import {
  CORE_COL,
  MINER_H,
  TILE,
  WORLD_SIZES,
  coreDepthMetersFor,
  coreRowFor,
} from "../constants";
import {
  captureStill,
  createHarness,
  minerXOn,
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";

/** Half a meter: the depth is an exact expression of the miner's feet. */
const TOLERANCE_DIGITS = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts coreRow and the Core depth where the size fixes them", async () => {
  for (const size of WORLD_SIZES) {
    await openScene(h, { size });
    await pinMiner(h);
    await pinDrill(h);

    const expectedRow = coreRowFor(size);
    const opened = await h.snapshot();
    assertEqual(
      opened.worldSize,
      size,
      "specs/instrumentation.md: setWorldSize sets the expedition's size",
    );
    assertEqual(
      opened.coreRow,
      expectedRow,
      `specs/world.md: coreRow is round(STANDARD_ROWS * WORLD_SIZE_SCALE) at ${size}`,
    );
    assertEqual(
      (await h.tileAt(CORE_COL, expectedRow)).kind,
      "core",
      `specs/world.md: the Core tile sits at (CORE_COL, coreRow) at ${size}`,
    );

    // The miner's feet at the foot of the Core chamber, which is the depth the
    // size-select screen quotes for that size.
    await h.debug.setMinerPosition(
      minerXOn(CORE_COL),
      (expectedRow + 1) * TILE - MINER_H,
    );
    await h.debug.setMinerVelocity(0, 0);
    await h.advance(1);
    assertCloseTo(
      (await h.snapshot()).depthMeters,
      coreDepthMetersFor(size),
      TOLERANCE_DIGITS,
      `specs/world.md: the Core depth in meters at ${size}`,
    );

    if (size === "marathon") await captureStill(h, "depth");
  }
});
