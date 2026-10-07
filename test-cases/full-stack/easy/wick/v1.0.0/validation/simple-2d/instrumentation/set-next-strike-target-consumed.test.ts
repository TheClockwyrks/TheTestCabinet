// instrumentation/set-next-strike-target-consumed — the firing that strikes a
// posed target consumes it, so `nextStrikeTarget` reads `null` afterwards.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md ("Drawn outcomes"):
// each value "is `null` on the idle run and after the draw that consumed it";
// `setNextStrikeTarget`: "that firing consumes it".
//
// THE POSE. As `set-next-strike-target`: an isolated night with four owls at
// the posts and Spark at level 1 fired once.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { armSpark, strikesIn, targetsFor } from "../spark/strike";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads null once the firing has struck the posed target", async () => {
  const volley = armSpark(h, 1, targetsFor(4), "owl");
  h.debug.setNextStrikeTarget(volley.targets[1].id);
  assertEqual(
    h.snapshot().run.nextStrikeTarget,
    volley.targets[1].id,
    "nextStrikeTarget before the firing",
  );

  const after = await h.tick(1);
  captureStill(h, "consumed");

  assertLength(strikesIn(after), 1, "strikes landed");
  assertNull(after.run.nextStrikeTarget, "nextStrikeTarget after the firing");
});
