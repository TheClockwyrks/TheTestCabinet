// screens/last-life-enters-gameover — spending the last life ends on game over.
//
// specs/field.md, the life-loss check: "if this tick's burn-ups removed the
// last live ball, one life is lost ... At zero lives the game moves to the
// `gameover` screen." specs/screens.md, on `playing`: "the life loss that
// spends the last life ... sets it to `gameover`."
//
// The field is isolated and the lives posed to `1`, so the one staged burn-up
// is the loss that spends the last life. The ball is sent straight inward on
// the far side from the deflector, and the burn-up and the transition are the
// game's own ticks' work; the budget is generous over the ~15 ticks the fall
// from radius 150 to the burn-up threshold of 78 takes at 300 units/second.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("the life loss that spends the last life sets screen to gameover", async () => {
  await isolate(h);
  await h.debug.setLives(1);
  await spawnBallPolar(h, 150, 270, 300, 180);

  const result = await captureReplay(h, "last-life-burnup", async () =>
    h.until((s) => s.screen === "gameover", { maxTicks: 60 }),
  );

  assertTrue(result.hit, "a gameover transition within the 60-tick budget");
  assertEqual(
    result.snapshot.screen,
    "gameover",
    "the screen the last life's loss set",
  );
});
