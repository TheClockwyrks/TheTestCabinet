// Wick — instrumentation/set-next-strike-target: `setNextStrikeTarget(id)` on
// `playing` sets `nextStrikeTarget` to that id, the snapshot reads it back,
// and the next Spark firing's first strike lands on that enemy.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`
// ("Drawn outcomes", `setNextStrikeTarget(id)`): "The first strike of the
// next Spark firing lands on that enemy when it is alive and within
// `SPARK_RANGE` of the player's center on the tick of the firing".
// `specs/weapons.md` ("Spark"): a strike zone is centered on the target it
// landed on.
//
// THE POSE. An isolated night with four owls at `spark/strike`'s posts, well
// inside `SPARK_RANGE`, Spark at level 1, whose row lands one strike, and the
// posed target the third owl, so a build that always struck the first or the
// nearest is told from one that took the pose. `TRIALS` (`10`) firings are
// read under the same pose, so a build that took it by chance one in four is
// caught. Owls outlive the strikes, so the four stand for every firing.
//
// THE TOLERANCE. `REAL_EPS` on the strike's center against the posed owl's
// post, a copy, through `postOf`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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
import { postOf, TARGET_POSTS } from "../spark/strike";

const POSED_INDEX = 2;
const TRIALS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("poses the next strike's target, and the strike lands on it", async () => {
  isolate(h);
  const origin = h.snapshot().run.player;
  const targets = TARGET_POSTS.map((post) =>
    placeEnemyNear(h, "owl", post.x, post.y),
  );
  const posed = targets[POSED_INDEX];
  const slot = holdWeapon(h, "spark", 1);

  for (let trial = 1; trial <= TRIALS; trial += 1) {
    h.debug.setNextStrikeTarget(posed);
    assertEqual(
      h.snapshot().run.nextStrikeTarget,
      posed,
      `nextStrikeTarget after the pose, trial ${trial}`,
    );
    armWeapon(h, slot);
    const before = h.snapshot();
    const after = await advanceTicks(h, 1);
    if (trial === TRIALS) captureStill(h, "struck");

    const strikes = zonesCreatedSince(before, after).filter(
      (zone) => zone.kind === "strike",
    );
    assertEqual(strikes.length, 1, `new Spark strikes on trial ${trial}`);
    assertEqual(
      postOf(strikes[0], TARGET_POSTS, origin),
      POSED_INDEX,
      `the owl the strike of trial ${trial} landed on`,
    );
  }
});
