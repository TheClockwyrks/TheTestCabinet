// instrumentation/set-lives — `setLives(n)` poses the lives play carries on
// from.
//
// specs/instrumentation.md, on `setLives`: "Set ... the lives to `n` ... Play
// carries on from the posed figure: ... a life loss at posed lives `1` ends
// the game." The life loss this scenario feeds it is the game's own: the only
// ball in play falling to the planet's burn-up radius (specs/field.md), the
// loss that costs a life when it leaves no ball.
//
// THE WORLD IS ONE FALLING BALL. The field is isolated, the ball is posed
// falling straight in at an angle far outside the deflector's span so nothing
// deflects it, and the game itself resolves the burn-up, the loss of the
// posed last life, and the game over.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { polarPose } from "./helpers";

/** Where the last ball is posed: falling straight in, far from the deflector. */
const FALL = polarPose(150, 200, -240, 0);

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("poses the lives, and a life loss at 1 ends the game", async () => {
  await isolate(h);
  await h.debug.setLives(1);
  assertEqual((await h.snapshot()).lives, 1, "the posed lives, read back");

  await h.debug.spawnBall(FALL.x, FALL.y, FALL.vx, FALL.vy);
  const run = await captureReplay(h, "last-life", () =>
    h.until((s) => s.screen === "gameover", { maxTicks: 60 }),
  );

  assertTrue(run.hit, "the game over a life loss at posed lives 1 implies");
  assertEqual(run.snapshot.lives, 0, "the posed last life, spent");
});
