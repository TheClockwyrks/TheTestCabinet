// Wick — instrumentation/set-next-puddle-offset-consumed: the firing that
// lands a puddle at a posed offset consumes it, so
// `nextPuddleOffset` reads `null` afterwards.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`
// ("Drawn outcomes"): each value "is `null` on the idle run and after the
// draw that consumed it"; `setNextPuddleOffset`: "that firing consumes it".
//
// THE POSE. As `set-next-puddle-offset`: an isolated night, Oil Splash at
// level 1 fired once.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNull } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { fireFromPosed } from "../oil-splash/firing";

const OFFSET = { x: 90, y: -60 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads null once the firing has taken the posed offset", async () => {
  isolate(h);
  h.debug.setNextPuddleOffset(OFFSET.x, OFFSET.y);
  assertDeepEqual(
    h.snapshot().run.nextPuddleOffset,
    OFFSET,
    "nextPuddleOffset before the firing",
  );

  const firing = await fireFromPosed(h, 1);
  captureStill(h, "consumed");

  assertLength(firing.puddles, 1, "puddles the level-1 firing created");
  assertNull(
    firing.after.run.nextPuddleOffset,
    "nextPuddleOffset after the firing",
  );
});
