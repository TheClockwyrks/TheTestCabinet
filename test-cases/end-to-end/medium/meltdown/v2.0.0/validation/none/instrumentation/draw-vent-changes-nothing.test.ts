// Meltdown — instrumentation/draw-vent-changes-nothing: a run of draws leaves the
// game exactly as it stood.
//
// THE RULE. `specs/instrumentation.md`, of `drawVent()`: "Nothing else happens:
// no unit is added, and a posed `spawnVent` is neither consulted nor changed."
//
// A BUSY WORLD, READ TWICE WITH NO FRAME BETWEEN. Towers, units from both vents,
// a selection, a held preview, a shut world gate and a posed vent are all on the
// floor, the snapshot is taken, two hundred draws are made, and the snapshot is
// taken again: the two must agree field for field. A build whose draw releases
// the unit it drew, consumes or moves the pose, or advances the spawner's clock
// fails on the field that moved. The one frame after the second reading is for
// the picture alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  drawVents,
  poseTower,
  poseWalker,
  startRun,
  type Harness,
} from "../harness";

/** Draws made between the two readings. */
const DRAWS = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the posed world untouched by a run of draws", async () => {
  await startRun(h);
  const site = freeSite(0);
  const tower = await poseTower(h, "arc", site.col, site.row);
  await poseWalker(h, "mote", "left");
  await poseWalker(h, "hulk", "top");
  await h.debug.setPhase("wave");
  await h.debug.setWavePending(9);
  await h.debug.setSelected(tower);
  await h.debug.setArmed("rime");
  await h.debug.setSpawnVent("top");

  const before = await h.snapshot();
  await drawVents(h, DRAWS);
  const after = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "unchanged");

  assertDeepEqual(
    after,
    before,
    `the snapshot after ${DRAWS} draws, against the one before them`,
  );
});
