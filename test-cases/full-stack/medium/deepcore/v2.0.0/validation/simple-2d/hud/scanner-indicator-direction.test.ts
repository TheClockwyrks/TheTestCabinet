// hud/scanner-indicator-direction — the indicator says WHICH WAY the node lies.
//
// `specs/ui.md`: while the scanner is locked on, a direction to the target and a
// distance are drawn over the world.
//
// THIS POINT DECIDES THE DIRECTION. The node is placed the same number of tiles
// east and then west of the miner, so the distance is identical either way and
// the only thing that changed is which way the target lies. A build whose
// indicator says how far but never which way draws the same thing twice and fails
// here.
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
const APART = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a different indicator for a node east and a node west", async () => {
  openScene(h);
  pinDrill(h);
  layFloor(h, ROW);
  standOn(h, COL, ROW);
  // Tier 3 reaches the full width of the world, so a node a dozen tiles away is
  // locked while sitting outside the viewport.
  stageTiers(h, { scanner: 3 });

  layMaterial(h, COL + APART, ROW, "resonite");
  const east = await sampleView(h);
  const eastAgain = await sampleView(h);
  const locked = h.snapshot().scanner;
  captureStill(h, "direction");

  h.debug.setTile(COL + APART, ROW, "rock");
  layMaterial(h, COL - APART, ROW, "resonite");
  const west = await sampleView(h);

  assertEqual(locked.locked, true, "specs/mining.md");
  assertEqual(locked.target, "resonite", "specs/mining.md");
  assertEqual(changed(east, eastAgain), 0, "specs/ui.md");
  assertGreaterThan(
    changed(east, west),
    0,
    "specs/ui.md: the indicator follows the direction the target lies in",
  );
});
