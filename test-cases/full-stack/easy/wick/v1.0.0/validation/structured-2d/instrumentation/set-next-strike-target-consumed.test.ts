// Wick — instrumentation/set-next-strike-target-consumed: the firing that
// strikes a posed target consumes it, so `nextStrikeTarget` reads `null`
// afterwards.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`
// ("Drawn outcomes"): each value "is `null` on the idle run and after the
// draw that consumed it"; `setNextStrikeTarget`: "that firing consumes it".
//
// THE POSE. As `set-next-strike-target`: an isolated night with four owls at
// the posts and Spark at level 1 fired once.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import {
  advanceTicks,
  armWeapon,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  placeEnemyNear,
  zonesCreatedSince,
  type Harness,
} from "../harness";
import { TARGET_POSTS } from "../spark/strike";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads null once the firing has struck the posed target", async () => {
  isolate(h);
  const targets = TARGET_POSTS.map((post) =>
    placeEnemyNear(h, "owl", post.x, post.y),
  );
  const slot = holdWeapon(h, "spark", 1);
  h.debug.setNextStrikeTarget(targets[1]);
  assertEqual(
    h.snapshot().run.nextStrikeTarget,
    targets[1],
    "nextStrikeTarget before the firing",
  );

  armWeapon(h, slot);
  const before = h.snapshot();
  const after = await advanceTicks(h, 1);
  captureStill(h, "consumed");

  assertLength(
    zonesCreatedSince(before, after).filter((zone) => zone.kind === "strike"),
    1,
    "strikes landed",
  );
  assertNull(after.run.nextStrikeTarget, "nextStrikeTarget after the firing");
});
