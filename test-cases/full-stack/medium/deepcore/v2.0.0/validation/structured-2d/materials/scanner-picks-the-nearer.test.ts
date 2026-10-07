// materials/scanner-picks-the-nearer — with both missing, the nearer node wins.
//
// `specs/mining.md` closes the targeting rule with the case where neither
// material is held: "With both missing it targets whichever is nearer." The
// satchel is left empty, both nodes are posed well inside tier 3's range, and
// the miner is then moved from beside one to beside the other, so the only thing
// that changes between the two readings is which node is nearer.
//
// Moving the miner rather than the nodes is what makes this a check on the rule
// rather than on the pose: the same two nodes stand in the same two cells
// throughout, and the answer still has to change.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import { captureStill, createHarness, standOn, type Harness } from "../harness";
import {
  cellDistance,
  minerCell,
  MINER_COL,
  openScanner,
  poseNode,
  settled,
} from "./scanner-scene";

/** The two node rows, both inside tier 3's range from either miner cell. */
const RESONITE_ROW = 16;
const CRYENITE_ROW = 31;

/** The row the miner moves down to, which is nearer the Cryenite node. */
const SECOND_ROW = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("targets whichever node is nearer while both materials are missing", async () => {
  openScanner(h, 3);
  const resonite = { col: MINER_COL, row: RESONITE_ROW };
  const cryenite = { col: MINER_COL, row: CRYENITE_ROW };
  poseNode(h, resonite, "resonite");
  poseNode(h, cryenite, "cryenite");

  const high = await settled(h);
  captureStill(h, "nearer");
  assertEqual(high.satchel.resonite, 0, "specs/mining.md, both missing");
  assertEqual(high.satchel.cryenite, 0, "specs/mining.md, both missing");
  assertLessThan(
    cellDistance(minerCell(high), resonite),
    cellDistance(minerCell(high), cryenite),
    "specs/mining.md, the pose puts Resonite nearer",
  );
  assertEqual(high.scanner.locked, true, "specs/mining.md");
  assertEqual(high.scanner.target, "resonite", "specs/mining.md");

  standOn(h, MINER_COL, SECOND_ROW);
  const low = await settled(h);
  assertLessThan(
    cellDistance(minerCell(low), cryenite),
    cellDistance(minerCell(low), resonite),
    "specs/mining.md, the move puts Cryenite nearer",
  );
  assertEqual(low.scanner.locked, true, "specs/mining.md");
  assertEqual(low.scanner.target, "cryenite", "specs/mining.md");
});
