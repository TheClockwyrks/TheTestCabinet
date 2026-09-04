// hud/scanner-indicator-distance — the indicator says HOW FAR the node lies.
//
// `specs/ui.md`: while the scanner is locked on, a direction to the target and a
// distance are drawn over the world.
//
// THIS POINT DECIDES THE DISTANCE. The node is placed at two different distances
// on the SAME side of the miner, so the direction is identical either way and the
// only thing that changed is how far the target is. A build whose indicator says
// which way but never how far draws the same thing twice and fails here.
//
// WHAT IS READ, AND WHY IT IS THE FAIR READING. What the indicator LOOKS like is
// the build's, so what can be read is that it is there and that it follows the
// target. Every reading below is a difference over the mine viewport between two
// poses that differ in nothing else.
//
// THREE POINTS, because the specification names three things: that the indicator
// is drawn at all, that it carries a DIRECTION, and that it carries a DISTANCE.
// A build that draws an arrow and no range must grade differently from one that
// draws nothing. The three are `hud/scanner-indicator`,
// `hud/scanner-indicator-direction` and `hud/scanner-indicator-distance`.
//
// THE NODE IS KEPT OFF SCREEN throughout, more than eight tiles from a miner
// centred in a viewport sixteen tiles wide, so the node's own cell is never part
// of what is compared. No clock moves under a read, so the same pose read twice
// comes back identical, and that control is asserted.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  layFloor,
  layMaterial,
  openScene,
  pinDrill,
  stageTiers,
  standOn,
  type Harness,
} from "../harness";
import { changed, sampleView } from "./bar";

/** A row in the rockbed at the Standard size, where the Resonite node belongs. */
const ROW = 200;

/** The miner's column, and how far the node is placed from it in tiles. */
const COL = 16;
/** Both are past the viewport's eight-tile half-width and inside the world. */
const NEAR = 10;
const FAR = 14;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a different indicator for a near node and a far one", async () => {
  openScene(h);
  pinDrill(h);
  layFloor(h, ROW);
  standOn(h, COL, ROW);
  // Tier 3 reaches the full width of the world, so a node a dozen tiles away is
  // locked while sitting outside the viewport.
  stageTiers(h, { scanner: 3 });

  layMaterial(h, COL + NEAR, ROW, "resonite");
  const near = await sampleView(h);
  const nearAgain = await sampleView(h);
  const locked = h.snapshot().scanner;
  captureStill(h, "distance");

  h.debug.setTile(COL + NEAR, ROW, "rock");
  layMaterial(h, COL + FAR, ROW, "resonite");
  const far = await sampleView(h);

  assertEqual(locked.locked, true, "specs/mining.md");
  assertEqual(locked.target, "resonite", "specs/mining.md");
  assertEqual(changed(near, nearAgain), 0, "specs/ui.md");
  assertGreaterThan(
    changed(near, far),
    0,
    "specs/ui.md: the indicator follows how far the target is",
  );
});
