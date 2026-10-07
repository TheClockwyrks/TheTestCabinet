// scoring/capped-multiball-catch-scores — a multiball pod caught at the
// six-ball cap still awards the 25.
//
// specs/scoring.md: "Every pod catch awards the `25` ... a `multiball` pod
// caught at the ball cap included." specs/pods.md, on multiball: "As many of
// the two launch as the six-ball cap admits ... At the cap the catch scores
// and launches nothing." Six balls are posed far from the deflector, a
// multiball pod is dropped onto it, and the sweep's first score change reads
// the exact CARRIED + 25. That the catch launches nothing is the effects
// category's point; this validator decides only that the capped catch scored.
//
// THE WORLD IS SIX GLIDING BALLS, ONE POD, AND THE RESTING DEFLECTOR. The
// balls glide tangentially at radius 400 in an empty field, well away from
// every contact that could score or burn during the short fall.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { BALL_CAP, POD_CATCH_SCORE, ballSpeedAtWave } from "../constants";
import {
  captureReplay,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import {
  CARRIED,
  SWEEP_TICKS,
  podOntoDeflector,
  scored,
  stageCarried,
} from "./pose";

/** Where the cap-filling balls glide: far from planet, deflector, and field. */
const BALL_RADIUS_POSED = 400;
const BALL_THETAS = [150, 195, 240, 285, 330, 15];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("awards the 25 for a multiball pod caught at the cap", async () => {
  stageCarried(h);
  for (const theta of BALL_THETAS) {
    // Zero radial, all tangential: a glide that stays at radius.
    spawnBallPolar(h, BALL_RADIUS_POSED, theta, 0, ballSpeedAtWave(1));
  }
  const posed = h.snapshot();
  assertLength(posed.balls, BALL_CAP, "the six-ball cap filled");
  podOntoDeflector(h, "multiball");

  const swept = await captureReplay(h, "catch", () =>
    h.until(scored(CARRIED), { maxTicks: SWEEP_TICKS }),
  );

  assertTrue(swept.hit, "a score change within the sweep");
  assertEqual(
    swept.snapshot.score,
    CARRIED + POD_CATCH_SCORE,
    "the capped catch's award",
  );
  assertLength(swept.snapshot.pods, 0, "the caught pod removed");
});
