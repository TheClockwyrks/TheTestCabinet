// building/preview-valid-on-open-floor — a footprint on open, affordable floor
// reads valid.
//
// specs/building.md, Valid and invalid: a held footprint is valid exactly when
// all six conditions hold — every tile on the grid, every tile open, no tile
// under a surge unit's centre, the money at least the build cost, every tile
// inside the mode's build zone where it fixes one, and the never-seal rule of
// specs/mazing.md satisfied.
//
// The world is posed so all six hold and nothing else is on the floor: a
// Containment run, which fixes no build zone (specs/modes.md), no tower, no surge
// unit, a purse far above every cost, and three footprints laid on empty floor
// well clear of the four openings, so no placement could come near sealing the
// route from either vent to its exhaust.
//
// All three footprint sizes are read, because the six conditions are stated over
// "every tile of the footprint" and a build that checked only its anchor tile
// would answer a 2x2 correctly and a 4x4 by luck.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  sizeOf,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";
import { probeValid } from "./preview";

/** Enough money for every one of them, so condition 4 is never what fails. */
const PURSE = 1000;

/**
 * One footprint per size, on open floor in the band of rows 4-7. That band is
 * clear of the left vent and right exhaust (rows 16-19) and of the top vent and
 * bottom exhaust (columns 22-29), so none of these tiles is on either route's
 * only way through (specs/floor.md, The openings).
 */
const FOOTPRINTS: readonly { type: TowerType; col: number; row: number }[] = [
  { type: "arc", col: 4, row: 4 },
  { type: "bloom", col: 8, row: 4 },
  { type: "lance", col: 12, row: 4 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads a buildable footprint on open floor as valid", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);

  for (const { type, col, row } of FOOTPRINTS) {
    const size = sizeOf(type);
    assertEqual(
      probeValid(h, type, col, row),
      true,
      `${type} (${size}x${size}) on open floor at (${col}, ${row})`,
    );
  }

  await h.advance(1);
  captureStill(h, "valid");
});
