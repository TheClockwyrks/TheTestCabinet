// Deepcore — supplies/explosives-detonate-gas: a pocket inside the block goes off
// like a drilled one.
//
// `specs/items.md`: "A gas pocket in the block detonates exactly as a drilled one
// does. The miner is at the center of the block, so a hidden pocket can hurt or
// kill it." `specs/hazards.md` fixes what "exactly as a drilled one" costs: a
// detonation at depth fraction `f` deals
// `GAS_DAMAGE_MIN + (GAS_DAMAGE_MAX - GAS_DAMAGE_MIN) * max(0, f - 0.25) / 0.75`
// hull to a miner inside `GAS_BLAST_TILES`.
//
// So one pocket is posed in the cell beside the miner, inside a `3x3` Dynamite
// block and one tile from the miner's centre, and the hull the charge cost is
// held against that formula at that cell's depth. The pocket sits in the rockbed,
// the band `specs/world.md` first places gas in, so the figure under test is a
// real point on the curve rather than its floor. The hull tier is raised only so
// the blast is survivable: a dead miner ends the expedition and answers nothing.
//
// Half a point of hull is allowed either way, which lets a build keep hull as a
// whole number and still pass, and is far tighter than the twenty-two points that
// separate this depth's damage from `GAS_DAMAGE_MIN`.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { gasDamageAt, HULL_TIERS } from "../constants";
import {
  captureReplay,
  createHarness,
  depthFraction,
  type Harness,
} from "../harness";
import { AFTERMATH_FRAMES, openBlastScene, ROCKBED_ROW } from "./blast-scene";

/** Enough hull to survive a rockbed detonation with room to spare. */
const HULL_TIER = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("detonates a gas pocket inside the block at that depth's damage", async () => {
  const centre = openBlastScene(h, ROCKBED_ROW);
  h.debug.setTier("hull", HULL_TIER);
  h.debug.setHull(HULL_TIERS[HULL_TIER - 1]);

  const pocket = { col: centre.col + 1, row: centre.row };
  h.debug.setTile(pocket.col, pocket.row, "gas");
  h.debug.setItemCount("dynamite", 1);

  const before = h.snapshot();
  const fraction = depthFraction(pocket.row, before.coreRow);
  const expected = gasDamageAt(fraction);

  await captureReplay(h, "chain", async () => {
    h.debug.useItem("dynamite");
    await h.advance(AFTERMATH_FRAMES);
  });

  const after = h.snapshot();
  assertEqual(
    h.tileAt(pocket.col, pocket.row).kind,
    "tunnel",
    "the pocket's cell after the blast",
  );
  assertCloseTo(
    before.miner.hull - after.miner.hull,
    expected,
    0,
    `hull a detonation at depth fraction ${fraction.toFixed(4)} costs`,
  );
});
