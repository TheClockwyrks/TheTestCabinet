// screens/clearing-enters-waveclear — the clearing event enters the interstitial.
//
// specs/screens.md, on `playing`: "the clearing event, fixed in `specs/rings.md`,
// sets it to `waveclear`." specs/rings.md fixes the event: "a hit from a ball
// destroys a target and leaves zero live targets across all three rings. At that
// instant [...] the `waveclear` interstitial begins."
//
// The field is isolated down to one hp-1 target on ring 1 — which does not orbit
// at wave 1, so the posed arc stays put. The waveAdvance switch `isolate` holds
// off is turned back on, because the clearing event is exactly what this point
// decides; podSpawn stays off so no pod arrives on top of the destruction. A
// ball is posed just outside the ring, falling straight in onto the target's
// arc, and the sweep watches the screen alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  targetArcCenterDeg,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("enters the interstitial from the clearing destruction", async () => {
  isolate(h);
  h.debug.setWaveAdvance(true);
  h.debug.spawnTarget(1, 0, 1);
  const arc = targetArcCenterDeg(1, 0, 0);
  spawnBallPolar(h, 350, arc, -240, 0);

  const swept = await captureReplay(h, "clearing", () =>
    h.until((s) => s.screen === "waveclear", { maxTicks: 60 }),
  );

  assertEqual(
    swept.snapshot.screen,
    "waveclear",
    "the screen after the destruction that left zero live targets",
  );
});
