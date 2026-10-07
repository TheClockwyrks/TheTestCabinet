// hud/scanner-indicator-hidden — nothing is drawn when nothing is locked.
//
// `specs/ui.md`: nothing is drawn when nothing is locked. `specs/mining.md` gives
// the two ways that happens — the miner has no scanner, or the target is outside
// the tier's range — and `specs/instrumentation.md` makes the snapshot say so,
// with `scanner.locked` false and the distance `null`, "matching the indicator
// being hidden".
//
// So the mine viewport is read three ways over one world holding one Resonite
// node twelve tiles from the miner and outside the viewport: at tier 1, which is
// no scanner; at tier 2, whose ten-tile range does not reach it; and at tier 3,
// which does. The first two must be drawn IDENTICALLY — an indicator drawn empty
// or pointing nowhere would not be — while the third proves the world could tell
// the difference. No clock moves under a read, so identical means exactly that.

import { afterEach, beforeEach, it } from "vitest";
import { SCANNER_TIERS } from "../constants";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
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

const ROW = 200;
const COL = 16;

/** Twelve tiles: past tier 2's ten-tile range, inside tier 3's. */
const APART = 12;

/** Tier 2's lock range in tiles, as specs/upgrades.md states it. */
const TIER_2_RANGE = SCANNER_TIERS[1] ?? 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws nothing with no scanner and nothing with the node out of range", async () => {
  openScene(h);
  pinDrill(h);
  layFloor(h, ROW);
  standOn(h, COL, ROW);
  layMaterial(h, COL + APART, ROW, "resonite");

  stageTiers(h, { scanner: 1 });
  const none = await sampleView(h);
  const noScanner = h.snapshot().scanner;

  stageTiers(h, { scanner: 2 });
  const outOfRange = await sampleView(h);
  const tooFar = h.snapshot().scanner;
  captureStill(h, "hidden");

  stageTiers(h, { scanner: 3 });
  const inRange = await sampleView(h);
  const reached = h.snapshot().scanner;

  assertLessThan(TIER_2_RANGE, APART, "specs/upgrades.md");
  assertEqual(noScanner.locked, false, "specs/mining.md");
  assertEqual(tooFar.locked, false, "specs/mining.md");
  assertEqual(tooFar.distanceTiles, null, "specs/instrumentation.md");
  assertEqual(reached.locked, true, "specs/mining.md");
  assertEqual(changed(none, outOfRange), 0, "specs/ui.md");
  assertGreaterThan(changed(none, inRange), 0, "specs/ui.md");
});
