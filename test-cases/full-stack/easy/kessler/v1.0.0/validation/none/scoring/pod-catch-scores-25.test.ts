// scoring/pod-catch-scores-25 — a caught salvage pod raises the score by
// exactly 25, on the catch tick.
//
// specs/scoring.md's award table fixes "Catching a salvage pod" at `25`, and
// "Each award lands on the tick its event resolves." The catch is the crossing
// event of specs/pods.md: the pod's center radius moves from above 196 to 196
// or below within the deflector's span. The sweep's first score change is read
// as the exact CARRIED + 25, with the pod already removed in the same
// snapshot, so the award rode the catch tick itself.
//
// THE WORLD IS ONE POD AND THE RESTING DEFLECTOR. The field is emptied, no
// ball exists, and the pod falls straight down the deflector's own radial, so
// the one crossing that can score is the catch.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { PADDLE_START_ANGLE, POD_CATCH_POINTS } from "../constants";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  CARRIED,
  SWEEP_TICKS,
  podOntoDeflector,
  scored,
  stageCarried,
} from "./pose";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("awards exactly 25 on the catch tick", async () => {
  const posed = await stageCarried(h);
  assertEqual(
    posed.paddle.angleDeg,
    PADDLE_START_ANGLE,
    "the deflector resting at 90",
  );
  await podOntoDeflector(h, "widen");

  const swept = await captureReplay(h, "catch", () =>
    h.until(scored(CARRIED), { maxTicks: SWEEP_TICKS }),
  );

  assertTrue(swept.hit, "a score change within the sweep");
  assertEqual(
    swept.snapshot.score,
    CARRIED + POD_CATCH_POINTS,
    "the score on the catch tick",
  );
  assertLength(swept.snapshot.pods, 0, "the caught pod removed");
});
