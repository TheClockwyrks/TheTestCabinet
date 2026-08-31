// pods/catch-tests-span-in-force — the span the catch tests is the span in
// force that tick, so a widened deflector catches what the baseline lets past.
//
// specs/pods.md: "The span the catch tests is the span in force that tick",
// with widen putting a 72-degree span in force. The pod is posed 30 degrees
// off the deflector's center: outside the baseline 24-degree half-span, inside
// widen's 36 — and 6 whole degrees clear of BOTH boundaries, so no honest
// membership reading is being probed at its edge. With widen posed through the
// surface the crossing tick must catch the pod. A shield pod is used so the
// applied effect is read off shieldActive, leaving the span figures to the
// widen already in force.
//
// THE WORLD IS THE POD AND THE WIDENED DEFLECTOR ALONE: no target, no ball,
// both driver switches held off by the isolate pose.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { WIDEN_SPAN_DEG } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnPodPolar,
  type Harness,
} from "../harness";

/** One unit above the catch radius plus two whole ticks of fall. */
const START_R = 201;
/** Outside the baseline half-span (24), inside widen's (36). */
const OFFSET = 30;
const THETA = 90 + OFFSET;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("catches with the widened span what the baseline would miss", async () => {
  isolate(h);
  h.debug.setEffectTicks("widen", 600);
  assertEqual(
    h.snapshot().paddle.spanDeg,
    WIDEN_SPAN_DEG,
    "widen's 72-degree span is in force",
  );
  spawnPodPolar(h, "shield", START_R, THETA);

  await captureReplay(h, "widened-catch", async () => {
    const before = await h.tick(2);
    assertLength(before.pods, 1, "the pod has not yet crossed 196");

    const after = await h.tick(1);
    assertLength(after.pods, 0, "the widened span catches the crossing pod");
    assertTrue(after.effects.shieldActive, "the caught kind's effect applies");
  });
});
