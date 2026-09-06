// Wick — instrumentation/set-next-puddle-offset-consumed: the firing that lands
// its first puddle at a posed offset consumes it, so `nextPuddleOffset` reads
// `null` afterwards.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes"): each value "is `null` on the idle run and after the draw that
// consumed it"; `setNextPuddleOffset`: "that firing consumes it".
//
// WHY THE WORLD IS POSED AS IT IS. As `set-next-puddle-offset`: an isolated
// night, Oil Splash at level 1 fired once through the shared `fireWeapon`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  type Harness,
} from "../harness";
import { puddlesOf } from "../oil-splash/stage";

const OFFSET = { x: 90, y: -60 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads null once the firing has taken the posed offset", async () => {
  await isolate(h);
  await h.debug.setNextPuddleOffset(OFFSET.x, OFFSET.y);
  assertDeepEqual(
    (await h.snapshot()).run.nextPuddleOffset,
    OFFSET,
    "nextPuddleOffset before the firing",
  );

  const firing = await fireWeapon(h, "oil-splash", 1);
  await captureStill(h, "consumed");

  assertLength(puddlesOf(firing), 1, "puddles the level-1 firing created");
  assertNull(
    firing.after.run.nextPuddleOffset,
    "nextPuddleOffset after the firing",
  );
});
