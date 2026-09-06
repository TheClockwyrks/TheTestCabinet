// Wick — pickups/bread-drops: a common kill whose roll drops bread leaves one
// bread at its center, beside its gem, and nothing else.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("The drop roll"): "The
// roll drops bread with probability `BREAD_CHANCE` ... A kill therefore drops
// at most one of the two, and the pickup lands at the enemy's position beside
// its gem." Which way the roll falls is posed: `specs/instrumentation.md`
// ("Drawn outcomes", `setNextDrop(kind)`): "The next common enemy killed by a
// weapon while `drops` is on drops that pickup beside its gem ... in place of
// its roll". So a moth killed under a posed `bread` leaves exactly one gem and
// exactly one pickup, the pickup is bread, and both stand at the moth's
// center.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `drops` alone turned
// back on, the moth `KILL_DX` (`500`) units out, far outside every collection
// distance, so what the kill leaves lies where it fell. The kill is the real
// one, `pickups/roll`'s posed Oil Splash pulse on the moth's center, resolved
// by the next tick.
//
// THE TOLERANCE. None on the counts and the kind; `MOTION_EPS` on the centers,
// copies of the posed point.
//
// The other kind is `pickups/drafts-drop`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNear } from "../assert";
import { MOTION_EPS } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { killOne } from "./roll";

/** Where the moth stands: far outside every collection distance. */
const KILL_DX = 500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves one bread beside the gem of a kill posed to drop bread", async () => {
  isolate(h);
  enable(h, "drops");
  h.debug.setNextDrop("bread");
  const kill = await killOne(h, "moth", KILL_DX, 0);
  captureStill(h, "bread");

  assertLength(kill.gems, 1, "the gems the kill dropped");
  assertLength(kill.pickups, 1, "the pickups the kill dropped");
  const [bread] = kill.pickups;
  assertEqual(bread.kind, "bread", "the kind of the pickup the kill dropped");
  assertNear(bread.x, kill.at.x, MOTION_EPS, "the bread's x, the moth's own");
  assertNear(bread.y, kill.at.y, MOTION_EPS, "the bread's y, the moth's own");
  assertNear(kill.gems[0].x, kill.at.x, MOTION_EPS, "the gem's x beside it");
  assertNear(kill.gems[0].y, kill.at.y, MOTION_EPS, "the gem's y beside it");
});
