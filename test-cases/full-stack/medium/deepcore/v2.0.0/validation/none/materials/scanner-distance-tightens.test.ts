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
 * The frames the replay is padded with, so the reading closing is something a
 * reviewer can WATCH.
 *
 * Each station is one posed move and one settling frame, so the five of them
 * recorded back to back are five frames — a twenty-fourth of a second at the rate
 * this suite steps. The recorder is armed on the posed node for `RUN_UP`, each
 * station is held for `BETWEEN` after its reading is taken, and the last one is
 * held for `SETTLE`. The miner's travel is gated by `openScanner`, so the extra
 * frames move nothing and every reading is the one the station was posed at.
 */
const RUN_UP = 20;
const BETWEEN = 15;
const SETTLE = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the cell separation, falling on approach and rising on retreat", async () => {
  await openScanner(h, 3);
  const node = { col: MINER_COL, row: NODE_ROW };
  await poseNode(h, node, "resonite");

  const readings = await captureReplay(h, "closing", async () => {
    const seen: number[] = [];
    await h.advance(RUN_UP);
    for (const row of STATIONS) {
      await standOn(h, MINER_COL, row);
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
      await h.advance(BETWEEN);
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
