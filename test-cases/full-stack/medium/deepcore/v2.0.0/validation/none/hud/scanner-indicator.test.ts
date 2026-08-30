// hud/scanner-indicator — a locked scanner draws a direction and a distance.
//
// `specs/ui.md`: while the scanner is locked on, a direction to the target and a
// distance are drawn over the world. `specs/mining.md` fixes when it locks — the
// target is inside the tier's range, measured in tiles between the miner's cell
// and the node's — and `specs/upgrades.md` gives tier 1 no scanner at all.
//
// WHAT IS READ, AND WHY IT IS THE FAIR READING. What the indicator LOOKS like is
// the build's, so what can be read is that it is there and that it follows the
// target. Both are read as a difference over the mine viewport between poses that
// differ in nothing else:
//
//   * locked against unlocked — the same world, the same miner, the same node,
//     with only the scanner tier changed. Anything drawn differently is the
//     indicator.
//   * the node east against the node west — the same distance either way, so what
//     changes is the direction alone.
//
// THE NODE IS KEPT OFF SCREEN in both, at twelve tiles from a miner centred in a
// viewport sixteen tiles wide, so the node's own cell is never part of what is
// compared. Every read is a frame of no length, so the same pose read twice comes
// back identical and that control is asserted.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { SCANNER_RANGE } from "../constants";
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

/** The miner's column, and the two the node is placed at, twelve tiles either way. */
const COL = 16;
const APART = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws an indicator that follows the locked node", async () => {
  await openScene(h);
  await pinDrill(h);
  await layFloor(h, ROW);
  await standOn(h, COL, ROW);
  // Tier 3 reaches the full width of the world, so a node twelve tiles away is
  // locked while sitting outside the viewport.
  await stageTiers(h, { scanner: 3 });

  await layMaterial(h, COL + APART, ROW, "resonite");
  const east = await sampleView(h);
  const eastAgain = await sampleView(h);
  const locked = (await h.snapshot()).scanner;
  await captureStill(h, "locked");

  await stageTiers(h, { scanner: 1 });
  const unlocked = await sampleView(h);
  const unlockedRead = (await h.snapshot()).scanner;

  await stageTiers(h, { scanner: 3 });
  await h.debug.setTile(COL + APART, ROW, "rock");
  await layMaterial(h, COL - APART, ROW, "resonite");
  const west = await sampleView(h);

  assertEqual(SCANNER_RANGE[0], 0, "specs/upgrades.md");
  assertEqual(locked.locked, true, "specs/mining.md");
  assertEqual(locked.target, "resonite", "specs/mining.md");
  assertEqual(unlockedRead.locked, false, "specs/upgrades.md");
  assertEqual(changed(east, eastAgain), 0, "specs/ui.md");
  assertGreaterThan(changed(east, unlocked), 0, "specs/ui.md");
  assertGreaterThan(changed(east, west), 0, "specs/ui.md");
});
