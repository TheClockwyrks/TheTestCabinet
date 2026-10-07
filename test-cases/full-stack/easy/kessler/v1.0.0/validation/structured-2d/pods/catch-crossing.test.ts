// pods/catch-crossing — the tick a pod's center radius crosses 196 inside the
// span, the pod is caught: removed, its kind's effect applied.
//
// specs/pods.md: "In a tick where the pod's center radius moves from
// prev_r > 196 to new_r <= 196 with its center angle within the deflector's
// span ... the pod is caught. ... The caught pod is removed ... and the kind's
// effect applies." The pod is posed at radius 201 dead on the deflector's
// center angle, so the crossing lands on the third tick (197 → 195) with a
// whole unit clear of the boundary on each side — never a float-equality read
// at the contact radius. A pierce pod is used so the applied effect is read
// off its own timer, touching neither span figure.
//
// THE WORLD IS THE POD AND THE DEFLECTOR ALONE: no target, no ball, both
// driver switches held off by the isolate pose.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnPodPolar,
  type Harness,
} from "../harness";

/** One unit above the catch radius plus two whole ticks of fall. */
const START_R = 201;
/** The deflector's session-start center angle, where the pod is dropped. */
const CENTER = 90;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("catches the pod on the tick it crosses 196 within the span", async () => {
  isolate(h);
  spawnPodPolar(h, "pierce", START_R, CENTER);

  await captureReplay(h, "catch", async () => {
    const before = await h.tick(2);
    assertLength(
      before.pods,
      1,
      "at radius 197 the pod has not yet crossed 196",
    );

    const after = await h.tick(1);
    assertLength(after.pods, 0, "the crossing tick removes the caught pod");
    assertGreaterThan(
      after.effects.pierceTicks,
      0,
      "the caught kind's effect applies",
    );
  });
});
