// scoring/redundant-shield-catch-scores — a shield pod caught while a shield
// is already active still awards the 25.
//
// specs/scoring.md: "Every pod catch awards the `25`, a `shield` pod caught
// while a shield is active ... included." specs/pods.md: "Catching a `shield`
// pod while a shield is active scores and changes nothing else." The shield is
// raised through the surface first, then a shield pod is dropped onto the
// deflector: the sweep's first score change reads the exact CARRIED + 25. That
// the catch changes nothing else is the effects category's point; this
// validator decides only that the redundant catch scored.
//
// THE WORLD IS THE ACTIVE SHIELD, ONE POD, AND THE RESTING DEFLECTOR. No ball
// exists, so nothing can consume the shield and no other event can score.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { POD_CATCH_POINTS } from "../constants";
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

it("awards the 25 for a shield pod caught under an active shield", async () => {
  await stageCarried(h);
  await h.debug.setShield(true);
  const posed = await h.snapshot();
  assertTrue(posed.effects.shieldActive, "a shield already active");
  await podOntoDeflector(h, "shield");

  const swept = await captureReplay(h, "catch", () =>
    h.until(scored(CARRIED), { maxTicks: SWEEP_TICKS }),
  );

  assertTrue(swept.hit, "a score change within the sweep");
  assertEqual(
    swept.snapshot.score,
    CARRIED + POD_CATCH_POINTS,
    "the redundant catch's award",
  );
  assertLength(swept.snapshot.pods, 0, "the caught pod removed");
});
