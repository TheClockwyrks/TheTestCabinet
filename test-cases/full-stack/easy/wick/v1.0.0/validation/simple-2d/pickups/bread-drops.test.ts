// Wick — pickups/bread-drops: a common kill whose roll drops bread leaves one
// bread at its center, beside its gem, and nothing else.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll"): "The roll
// drops bread with probability `BREAD_CHANCE` ... A kill therefore drops at
// most one of the two, and the pickup lands at the enemy's position beside its
// gem." Which way the roll falls is posed: specs/instrumentation.md ("Drawn
// outcomes"), `setNextDrop(kind)`: "The next common enemy killed by a weapon
// while `drops` is on drops that pickup beside its gem ... in place of its
// roll". So a moth killed under a posed `bread` leaves exactly one gem and
// exactly one pickup, the pickup is bread, and both stand at the moth's center.
//
// THE WORLD. An isolated night with `drops` alone turned back on, the moth
// `KILL_DX` (500) units out, far outside every collection distance, so what the
// kill leaves lies where it fell. The kill is the real one, `pickups/night`'s
// posed Ember bolt on the moth's center, resolved by the next tick.
//
// TOLERANCE. None on the counts and the kind; `FIGURE_TOLERANCE` on the
// centers, copies of the posed point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import { FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { killOne } from "./sample";

/** Where the moth stands: far outside every collection distance. */
const KILL_DX = 500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
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
  assertWithin(
    bread.x,
    kill.at.x,
    FIGURE_TOLERANCE,
    "the bread's x, the moth's own",
  );
  assertWithin(
    bread.y,
    kill.at.y,
    FIGURE_TOLERANCE,
    "the bread's y, the moth's own",
  );
  assertWithin(
    kill.gems[0].x,
    kill.at.x,
    FIGURE_TOLERANCE,
    "the gem's x beside it",
  );
  assertWithin(
    kill.gems[0].y,
    kill.at.y,
    FIGURE_TOLERANCE,
    "the gem's y beside it",
  );
});
