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
 * Frames the recording holds at each station, and on either side of the walk.
 *
 * Each station settles in a single frame, so the bare readings are five frames of
 * recording — a flicker rather than something a reviewer can watch the indicator
 * tighten across. The miner is left standing at each station long enough for the
 * indicator to be read there, with the scene on screen before the first move and
 * after the last.
 */
const DWELL_FRAMES = 8;
const RUN_UP_FRAMES = 10;
const SETTLE_FRAMES = 12;

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
    // The scene at rest before the first station, so the walk has a beginning.
    await h.advance(RUN_UP_FRAMES);
    for (const row of STATIONS) {
      standOn(h, MINER_COL, row);
      const at = await settled(h);
      await h.advance(DWELL_FRAMES);
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
    }
    await h.advance(SETTLE_FRAMES);
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
