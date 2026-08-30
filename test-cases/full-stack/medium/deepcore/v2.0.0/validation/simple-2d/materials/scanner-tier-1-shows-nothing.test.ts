// materials/scanner-tier-1-shows-nothing — no scanner, no reading.
//
// `specs/upgrades.md` fixes tier 1 of the scanner track as "no scanner at all",
// and `specs/mining.md` fixes what the game shows without one: "While nothing is
// locked, and while the miner has no scanner, nothing is shown."
// `specs/instrumentation.md` states the resting values that stand for the
// indicator being hidden: `locked` false, the direction zero and the distance
// `null`.
//
// The node is posed one cell from the miner, which is as close as a needed node
// can be, so a build that locks at tier 1 cannot escape by being out of range.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { minerCell, openScanner, poseNode, settled } from "./scanner-scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("locks onto nothing at scanner tier 1, however close the node is", async () => {
  openScanner(h, 1);
  const posed = await settled(h);
  const me = minerCell(posed);
  poseNode(h, { col: me.col + 1, row: me.row }, "resonite");

  const after = await settled(h);
  captureStill(h, "none");

  assertEqual(after.tiers.scanner, 1, "specs/upgrades.md");
  assertEqual(after.satchel.resonite, 0, "specs/mining.md, the node is needed");
  assertEqual(after.scanner.locked, false, "specs/mining.md");
  assertNull(after.scanner.target, "specs/instrumentation.md");
  assertEqual(after.scanner.dirX, 0, "specs/instrumentation.md");
  assertEqual(after.scanner.dirY, 0, "specs/instrumentation.md");
  assertNull(after.scanner.distanceTiles, "specs/instrumentation.md");
});
