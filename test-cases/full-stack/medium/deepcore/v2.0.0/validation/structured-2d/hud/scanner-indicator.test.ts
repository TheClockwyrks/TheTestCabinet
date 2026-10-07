// hud/scanner-indicator — a locked scanner draws something over the world.
//
// `specs/ui.md`: while the scanner is locked on, a direction to the target and a
// distance are drawn over the world. `specs/mining.md` fixes when it locks — the
// target is inside the tier's range, measured in tiles between the miner's cell
// and the node's — and `specs/upgrades.md` gives tier 1 no scanner at all.
//
// THIS POINT DECIDES THAT SOMETHING IS THERE: the same world, the same miner, the
// same node, with only the scanner tier changed, drawn differently.
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
import { SCANNER_TIERS } from "../constants";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
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

it("draws an indicator a scanner-less pose does not", async () => {
  openScene(h);
  pinDrill(h);
  layFloor(h, ROW);
  standOn(h, COL, ROW);
  // Tier 3 reaches the full width of the world, so a node a dozen tiles away is
  // locked while sitting outside the viewport.
  stageTiers(h, { scanner: 3 });

  layMaterial(h, COL + APART, ROW, "resonite");
  const drawn = await sampleView(h);
  const drawnAgain = await sampleView(h);
  const locked = h.snapshot().scanner;
  captureStill(h, "locked");

  stageTiers(h, { scanner: 1 });
  const blank = await sampleView(h);
  const unlockedRead = h.snapshot().scanner;

  assertNull(SCANNER_TIERS[0], "specs/upgrades.md");
  assertEqual(locked.locked, true, "specs/mining.md");
  assertEqual(locked.target, "resonite", "specs/mining.md");
  assertEqual(unlockedRead.locked, false, "specs/upgrades.md");
  assertEqual(changed(drawn, drawnAgain), 0, "specs/ui.md");
  assertGreaterThan(
    changed(drawn, blank),
    0,
    "specs/ui.md: a locked scanner draws something the unlocked one does not",
  );
});
