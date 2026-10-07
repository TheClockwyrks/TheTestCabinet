// materials/scanner-distance-tightens — the reading closes as the miner closes.
//
// `specs/mining.md` fixes the distance the game shows as the straight-line
// distance in tiles between the miner's cell and the node's cell, and says it
// "tightens as the miner closes in". So the miner is posed at several cells down
// one column toward a single node and then back away from it, and each reading
// is held against the separation of the two cells the snapshot itself reports.
//
// Holding each reading against the cell separation rather than only against the
// one before it is what decides the rule instead of the trend: a build that
// reported a distance falling on some scale of its own would pass a check that
// only watched the numbers get smaller.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLessThan } from "../assert";
import {
  captureReplay,
  createHarness,
  standOn,
  type Harness,
} from "../harness";
import {
  cellDistance,
  minerCell,
  MINER_COL,
  openScanner,
  poseNode,
  settled,
} from "./scanner-scene";

/** The node's row, deep enough that every station below is inside tier 3. */
const NODE_ROW = 40;

/** The rows the miner is read from: closing in, then falling back. */
const STATIONS = [12, 20, 30, 36, 22];

/**
 * The frames the recording runs before the first input and after the last, and
 * the frames it holds between them.
 *
 * These bound the CLIP a reviewer watches, not the check: nothing below is
 * asserted against them. A bracket that opened on the input and closed on the
 * result would hand a reviewer a flicker a few frames long, so the recorder is
 * armed with the world at rest, holds long enough for each step to be seen, and
 * runs on once the behavior has settled.
 */
const RUN_UP = 15;
const HOLD = 10;
const SETTLE = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the cell separation, falling on approach and rising on retreat", async () => {
  openScanner(h, 3);
  const node = { col: MINER_COL, row: NODE_ROW };
  poseNode(h, node, "resonite");

  const readings = await captureReplay(h, "closing", async () => {
    const seen: number[] = [];
    await h.advance(RUN_UP);
    for (const row of STATIONS) {
      standOn(h, MINER_COL, row);
      const at = await settled(h);
      assertEqual(at.scanner.locked, true, `specs/mining.md, from row ${row}`);
      assertEqual(at.scanner.target, "resonite", "specs/mining.md");
      const expected = cellDistance(minerCell(at), node);
      assertCloseTo(
        at.scanner.distanceTiles ?? Number.NaN,
        expected,
        2,
        `specs/mining.md, from row ${row}`,
      );
      seen.push(at.scanner.distanceTiles ?? Number.NaN);
      await h.advance(HOLD);
    }
    await h.advance(SETTLE);
    return seen;
  });

  // The four stations that close in read shorter each time, and the last one,
  // which steps back up the column, reads longer than the one before it.
  for (let i = 1; i < STATIONS.length - 1; i += 1) {
    assertLessThan(
      readings[i],
      readings[i - 1],
      `specs/mining.md, closing from row ${STATIONS[i - 1]} to ${STATIONS[i]}`,
    );
  }
  assertLessThan(
    readings[readings.length - 2],
    readings[readings.length - 1],
    "specs/mining.md, the reading rises as the miner moves away",
  );
});
