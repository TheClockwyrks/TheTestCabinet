// Wick — instrumentation/set-next-strike-target-consumed: the firing that
// strikes a posed target consumes it, so `nextStrikeTarget` reads `null`
// afterwards.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes"): each value "is `null` on the idle run and after the draw that
// consumed it"; `setNextStrikeTarget`: "that firing consumes it".
//
// WHY THE WORLD IS POSED AS IT IS. As `set-next-strike-target`: an isolated
// night with four moths on the target ring and Spark at level 1 fired once.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  newZones,
  type Harness,
} from "../harness";
import { SPARK, placeTargets, ringPoints, strikesOf } from "../spark/stage";

const POINTS = ringPoints(4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads null once the firing has struck the posed target", async () => {
  await isolate(h);
  const moths = await placeTargets(h, "moth", POINTS);
  await h.debug.setNextStrikeTarget(moths[1]!.id);
  assertEqual(
    (await h.snapshot()).run.nextStrikeTarget,
    moths[1]!.id,
    "nextStrikeTarget before the firing",
  );

  const firing = await fireWeapon(h, SPARK, 1);
  await captureStill(h, "consumed");

  assertLength(
    strikesOf(newZones(firing.before, firing.after)),
    1,
    "strikes landed",
  );
  assertNull(
    firing.after.run.nextStrikeTarget,
    "nextStrikeTarget after the firing",
  );
});
