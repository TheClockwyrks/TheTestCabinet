// Meltdown — instrumentation/spawn-vent-pose-leaves-live-units: `setSpawnVent`
// poses the release alone and moves no unit already on the floor.
//
// THE RULE. `specs/instrumentation.md`: the pose "poses the release alone: it
// moves no live unit, and a released unit's exhaust and route follow its vent
// exactly as a drawn unit's do", and "A live unit's flight and its vent are fixed
// by its type and by where it entered, so no operation changes either on a unit
// already on the floor."
//
// THE READING IS THE WHOLE ROSTER, TWICE, WITH NO FRAME BETWEEN. Two units stand
// on the floor, one from each vent and each posed to a tile of its corridor, and
// the surge roster is read before the pose and again after it. The two readings
// must agree field for field: vent, exhaust, position, tile, route length, and
// everything else the snapshot reports. A build that re-vents live units, moves
// them to the posed vent's opening, or re-routes them to the other exhaust is
// named by the field that changed. No frame runs between the two readings, so the
// pose is the only thing that happened to the game.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { tileCX, tileCY } from "../constants";
import { laneTile } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseWalker,
  startRun,
  type Harness,
} from "../harness";

/** How far along each corridor its unit is posed, in tiles from the vent. */
const ALONG = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every live unit's vent, exhaust, position and route where they stood", async () => {
  await startRun(h);
  for (const vent of ["left", "top"] as const) {
    const id = await poseWalker(h, "mote", vent);
    const at = laneTile(vent, ALONG);
    await h.debug.setUnitPosition(id, tileCX(at.col), tileCY(at.row));
  }
  const before = await h.snapshot();
  assertLength(before.surge, 2, "precondition: one unit from each vent stood");

  await h.debug.setSpawnVent("top");
  const posedTop = await h.snapshot();
  await h.debug.setSpawnVent("left");
  const posedLeft = await h.snapshot();
  await h.debug.setSpawnVent(null);
  const cleared = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "held");

  assertDeepEqual(
    posedTop.surge,
    before.surge,
    'the surge roster after setSpawnVent("top"), against before it',
  );
  assertDeepEqual(
    posedLeft.surge,
    before.surge,
    'the surge roster after setSpawnVent("left"), against before it',
  );
  assertDeepEqual(
    cleared.surge,
    before.surge,
    "the surge roster after setSpawnVent(null), against before it",
  );
});
