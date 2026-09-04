// materials/scanner-range-tier-2 — tier 2 reaches ten tiles and no further.
//
// `specs/upgrades.md` gives scanner tier 2 a range of `10` tiles, and
// `specs/mining.md` fixes what range means: "The scanner locks on only while its
// target is within the tier's range, measured in tiles as the straight-line
// distance between the miner's cell and the node's cell."
//
// The node is posed one tile inside the range and then one tile outside it,
// along the row the miner stands in, so the separation is a whole number of
// tiles and the two readings differ in nothing but the distance. A tile either
// side of the bound rather than exactly on it, because whether a node exactly
// `10` tiles away is inside is the one thing the wording leaves open.

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
const TIER = 2;
const RANGE = SCANNER_RANGE[TIER - 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("locks inside ten tiles and stays unlocked beyond them", async () => {
  await openScanner(h, TIER);
  const me = minerCell(await settled(h));

  const inside = { col: me.col + RANGE - 1, row: me.row };
  await poseNode(h, inside, "resonite");
  const near = await settled(h);
  await captureStill(h, "range");
  assertEqual(near.scanner.locked, true, "specs/mining.md, one tile inside");
  assertEqual(near.scanner.target, "resonite", "specs/mining.md");
  assertCloseTo(
    near.scanner.distanceTiles ?? Number.NaN,
    cellDistance(minerCell(near), inside),
    2,
    "specs/mining.md",
  );

  await clearNode(h, inside);
  const outside = { col: me.col + RANGE + 1, row: me.row };
  await poseNode(h, outside, "resonite");
  const far = await settled(h);
  assertEqual(far.scanner.locked, false, "specs/mining.md, one tile outside");
  assertNull(far.scanner.target, "specs/instrumentation.md");
  assertNull(far.scanner.distanceTiles, "specs/instrumentation.md");
});
