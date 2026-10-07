// building/preview-valid-on-open-floor — a footprint on open, affordable floor
// reads valid.
//
// specs/building.md, Valid and invalid: a held footprint is valid exactly when all
// six conditions hold — every tile on the grid, every tile open, no tile under a
// surge unit's centre, the money at least the build cost, every tile inside the
// mode's build zone where it fixes one, and the never-seal rule of specs/mazing.md
// satisfied.
//
// THE WORLD IS POSED SO ALL SIX HOLD AND NOTHING ELSE IS ON THE FLOOR: a
// Containment run, which fixes no build zone (specs/modes.md), no tower, no surge
// unit, a purse far above every cost, and three footprints laid on open floor well
// clear of the four openings, so no placement could come near sealing the route
// from either vent to its exhaust.
//
// ALL THREE FOOTPRINT SIZES ARE READ, because the six conditions are stated over
// "every tile of the footprint" and a build that checked only its anchor tile
// would answer a 2x2 correctly and a 4x4 by luck.
//
// This is the affirmative half of the pair. `building/place-refused-when-invalid`
// and the two `preview-invalid-*` items are the negative halves, and between them
// they tell a build with a broken predicate from a build that answers `false` to
// everything it is asked.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import type { TowerType } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { probeValid, sizeOf } from "./preview";

/** Enough money for every one of them, so condition 4 is never what fails. */
const PURSE = 1000;

/**
 * One footprint per size, each on a quiet anchor from `fixtures.ts` — clear of
 * all four openings and of both straight vent-to-exhaust corridors, and six tiles
 * from its neighbour, so even the 4x4 covers nothing another one does.
 */
const FOOTPRINTS: readonly { type: TowerType; col: number; row: number }[] = [
  { type: "arc", ...freeSite(0) },
  { type: "bloom", ...freeSite(1) },
  { type: "lance", ...freeSite(2) },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("reads a buildable footprint on open floor as valid", async () => {
  await startRun(h);
  await h.debug.setMoney(PURSE);

  for (const { type, col, row } of FOOTPRINTS) {
    const size = sizeOf(type);
    assertEqual(
      await probeValid(h, type, col, row),
      true,
      `${type} (${size}x${size}) on open floor at (${col}, ${row})`,
    );
  }

  await h.advance(1);
  await captureStill(h, "valid");
});
