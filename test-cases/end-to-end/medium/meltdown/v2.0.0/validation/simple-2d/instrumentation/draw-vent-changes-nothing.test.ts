// Meltdown — instrumentation/draw-vent-changes-nothing: a run of draws leaves the
// game exactly as it stood.
//
// specs/instrumentation.md, of `drawVent()`: "Nothing else happens: no unit is
// added, and a posed `spawnVent` is neither consulted nor changed."
//
// A BUSY WORLD, READ TWICE WITH NO FRAME BETWEEN. A tower, units from both vents,
// a selection, a held preview, a shut world gate and a posed vent are all on the
// floor, the snapshot is taken, two hundred draws are made, and the snapshot is
// taken again: the two must agree field for field. A build whose draw releases
// the unit it drew, consumes or moves the pose, or advances the spawner's clock
// fails on the field that moved. The one frame after the second reading is for
// the picture alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawVents,
  poseTower,
  poseWalker,
  startRun,
  type Harness,
} from "../harness";
import { GUN } from "./scenes";

/** Draws made between the two readings. */
const DRAWS = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the posed world untouched by a run of draws", async () => {
  startRun(h);
  const tower = poseTower(h, "arc", GUN.col, GUN.row);
  poseWalker(h, "mote", "left");
  poseWalker(h, "hulk", "top");
  h.debug.setPhase("wave");
  h.debug.setWavePending(9);
  h.debug.setSelected(tower);
  h.debug.setArmed("rime");
  h.debug.setSpawnVent("top");

  const before = h.snapshot();
  drawVents(h, DRAWS);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "unchanged");

  assertDeepEqual(
    after,
    before,
    `the snapshot after ${DRAWS} draws, against the one before them`,
  );
});
