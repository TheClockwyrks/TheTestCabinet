// instrumentation/set-next-puddle-offset-consumed — the firing that lands its
// first puddle at a posed offset consumes it, so `nextPuddleOffset` reads
// `null` afterwards.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md ("Drawn outcomes"):
// each value "is `null` on the idle run and after the draw that consumed it";
// `setNextPuddleOffset`: "that firing consumes it".
//
// THE POSE. As `set-next-puddle-offset`: an isolated night, Oil Splash at
// level 1 fired once.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNull } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { armOilSplash, fireOnce } from "../oil-splash/puddle";

const OFFSET = { x: 90, y: -60 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads null once the firing has taken the posed offset", async () => {
  const armed = armOilSplash(h, 1);
  h.debug.setNextPuddleOffset(OFFSET.x, OFFSET.y);
  assertDeepEqual(
    h.snapshot().run.nextPuddleOffset,
    OFFSET,
    "nextPuddleOffset before the firing",
  );

  const { after, created } = await fireOnce(h, armed.slot);
  captureStill(h, "consumed");

  assertLength(created, 1, "puddles the level-1 firing created");
  assertNull(after.run.nextPuddleOffset, "nextPuddleOffset after the firing");
});
