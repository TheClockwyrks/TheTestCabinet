// instrumentation/set-next-strike-target — `setNextStrikeTarget(id)` on
// `playing` sets `nextStrikeTarget` to that id, the snapshot reads it back,
// and the next Spark firing's first strike lands on that enemy.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md ("Drawn outcomes",
// `setNextStrikeTarget(id)`): "The first strike of the next Spark firing lands
// on that enemy when it is alive and within `SPARK_RANGE` of the player's
// center on the tick of the firing". specs/weapons.md ("Spark"): a strike
// zone is centered on the target it landed on.
//
// THE POSE. An isolated night with four owls at the posts of `spark/strike`,
// well inside `SPARK_RANGE`, Spark at level 1, whose row lands one strike, and
// the posed target the third owl, so a build that always struck the first or
// the nearest is told from one that took the pose. `TRIALS` (10) firings are
// read under the same pose, so a build that took it by chance one in four is
// caught. Owls outlive the strikes, so the four stand for every firing.
//
// THE TOLERANCE. `FIGURE_TOLERANCE` on the strike's center against the posed
// owl's, a copy.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  armWeapon,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";
import { armSpark, strikesIn, targetOf, targetsFor } from "../spark/strike";

const POSTS = 4;
const POSED_INDEX = 2;
const TRIALS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("poses the next strike's target, and the strike lands on it", async () => {
  const volley = armSpark(h, 1, targetsFor(POSTS), "owl");
  const posed = volley.targets[POSED_INDEX];
  const seen = new Set<number>();

  for (let trial = 1; trial <= TRIALS; trial += 1) {
    h.debug.setNextStrikeTarget(posed.id);
    assertEqual(
      h.snapshot().run.nextStrikeTarget,
      posed.id,
      `nextStrikeTarget after the pose, trial ${trial}`,
    );
    armWeapon(h, volley.slot);
    const after = await h.tick(1);
    if (trial === TRIALS) captureStill(h, "struck");

    const fresh = strikesIn(after).filter((strike) => !seen.has(strike.id));
    for (const strike of fresh) seen.add(strike.id);
    assertEqual(fresh.length, 1, `new Spark strikes on trial ${trial}`);
    assertEqual(
      targetOf(fresh[0], volley.targets, `the strike of trial ${trial}`),
      POSED_INDEX,
      `the owl the strike of trial ${trial} landed on`,
    );
  }
});
