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
import { slotArcCenterDeg } from "../constants";
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

it("enters the interstitial from the clearing destruction", async () => {
  await isolate(h);
  await h.debug.setWaveAdvance(true);
  await h.debug.spawnTarget(1, 0, 1);
  const arc = slotArcCenterDeg(1, 0, 0);
  await spawnBallPolar(h, 350, arc, 240, 180);

  const swept = await captureReplay(h, "clearing", () =>
    h.until((s) => s.screen === "waveclear", { maxTicks: 60 }),
  );

  assertEqual(
    swept.snapshot.screen,
    "waveclear",
    "the screen after the destruction that left zero live targets",
  );
});
