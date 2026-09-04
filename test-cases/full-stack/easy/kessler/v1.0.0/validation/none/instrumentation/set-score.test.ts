// instrumentation/set-score — `setScore(n)` poses the score play carries on
// from.
//
// specs/instrumentation.md, on `setScore`: "Set the score ... to `n` ... Play
// carries on from the posed figure: the next scoring event adds to the posed
// score." The event this scenario feeds it is a plain hit, worth the 50
// points specs/scoring.md fixes.
//
// THE WORLD HOLDS ONE TARGET AND ONE BALL. The target is posed with 2 hit
// points so the hit is not a destruction — no destroy award, no pod draw, no
// clearing — and the isolated field holds both driver switches off, so the 50
// points land on the posed 1000 alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { HIT_AWARD, polarPose, slotCenter } from "./helpers";

/** The posed score the next event must add to. */
const POSED = 1000;
/** The ring-1 slot the hit lands on, its arc center far from the deflector. */
const SLOT = 6;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("poses the score and the next scoring event adds to it", async () => {
  await isolate(h);
  await h.debug.setScore(POSED);
  assertEqual((await h.snapshot()).score, POSED, "the posed score, read back");

  await h.debug.spawnTarget(1, SLOT, 2);
  const ball = polarPose(270, slotCenter(1, SLOT), 240, 0);
  await h.debug.spawnBall(ball.x, ball.y, ball.vx, ball.vy);
  const run = await captureReplay(h, "scored", () =>
    h.until((s) => s.score !== POSED, { maxTicks: 12 }),
  );

  assertTrue(run.hit, "a scoring event after the pose");
  assertEqual(
    run.snapshot.score,
    POSED + HIT_AWARD,
    "the hit's 50 points, added to the posed figure",
  );
});
