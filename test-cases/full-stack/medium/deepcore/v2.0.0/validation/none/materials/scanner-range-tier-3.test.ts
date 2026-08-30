// materials/scanner-range-tier-3 — tier 3 reaches thirty-two tiles.
//
// `specs/upgrades.md` gives scanner tier 3 a range of `32` tiles and says what
// that buys: the band's node locks from anywhere across it once the miner is at
// its depth. The rule being read is the same one tier 2 is read against, on the
// same terms: the straight-line distance between the miner's cell and the node's
// cell, one tile inside the bound and one tile outside it.
//
// The separation runs down the column rather than across the row, because
// `specs/world.md` gives the world 32 columns and a horizontal offset of 33
// tiles would fall outside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertNull } from "../assert";
import { SCANNER_RANGE } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  cellDistance,
  clearNode,
  minerCell,
  openScanner,
  poseNode,
  settled,
} from "./scanner-scene";

/** The tier under test, and the range specs/upgrades.md gives it. */
const TIER = 3;
const RANGE = SCANNER_RANGE[TIER - 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("locks inside thirty-two tiles and stays unlocked beyond them", async () => {
  await openScanner(h, TIER);
  const me = minerCell(await settled(h));

  const inside = { col: me.col, row: me.row + RANGE - 1 };
  await poseNode(h, inside, "cryenite");
  const near = await settled(h);
  await captureStill(h, "range");
  assertEqual(near.scanner.locked, true, "specs/mining.md, one tile inside");
  assertEqual(near.scanner.target, "cryenite", "specs/mining.md");
  assertCloseTo(
    near.scanner.distanceTiles ?? Number.NaN,
    cellDistance(minerCell(near), inside),
    2,
    "specs/mining.md",
  );

  await clearNode(h, inside);
  const outside = { col: me.col, row: me.row + RANGE + 1 };
  await poseNode(h, outside, "cryenite");
  const far = await settled(h);
  assertEqual(far.scanner.locked, false, "specs/mining.md, one tile outside");
  assertNull(far.scanner.target, "specs/instrumentation.md");
  assertNull(far.scanner.distanceTiles, "specs/instrumentation.md");
});
