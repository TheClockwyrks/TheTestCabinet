// targets/face-hit-from-inside — a ball crossing a ring's inner contact radius
// outward, inside a live arc, scores a face hit — on each of the three rings'
// own radii.
//
// WHAT THE SPECIFICATION FIXES. specs/rings.md: "Face: in a tick where the
// ball's center radius crosses a ring's contact radius toward the ring, ...
// or from below the inner contact radius to on or above it, and the ball's
// center angle is within a live target's arc, the ball scores a face hit on
// that target." — with specs/field.md fixing the inner contact radii at 282,
// 352, and 422. "Each hit, face or edge, removes one hit point".
//
// THE READING BINDS THE RADIUS AS WELL AS THE HIT. The posed geometry crosses
// the inner contact radius on a known tick (spawned 5 below it, 4 units of
// travel per tick, so the crossing tick ends 3 above it), and the ball's
// radius at the hit tick must sit in that crossing's window — a build that
// contacts at the annulus edge, or before the crossing, resolves the hit at a
// radius outside it.
//
// THE WORLD IS ONE FROZEN RING'S LONE TARGET AND ONE OUTWARD BALL per probe,
// spawned in the clear interior below the ring (every other ring's slots are
// empty, so the flight crosses nothing else), at the arc's center.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertDefined,
  assertEqual,
  assertTrue,
} from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import {
  arcCenterDeg,
  ballAt,
  ballPolar,
  figures,
  freezeRing,
  placeTarget,
  PROBE_HP,
  PROBE_SPEED,
  targetAt,
} from "./rig";

const SLOT = 3;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

for (const RING of [1, 2, 3]) {
  it(`lands a face hit crossing ring ${RING}'s inner contact radius outward`, async () => {
    await isolate(h);
    await freezeRing(h, RING, 0);
    const fig = figures(RING);
    await placeTarget(h, RING, SLOT, PROBE_HP);

    const res = await captureReplay(h, `ring${RING}`, async () => {
      await ballAt(
        h,
        fig.contactInner - 5,
        arcCenterDeg(RING, SLOT, 0),
        PROBE_SPEED,
        0,
      );
      const hit = await h.until(
        (s) => {
          const t = targetAt(s, RING, SLOT);
          return t === undefined || t.hp < PROBE_HP;
        },
        { maxTicks: 8 },
      );
      await h.tick(4);
      return hit;
    });

    assertTrue(res.hit, "the outward crossing scores a face hit");
    assertEqual(
      targetAt(res.snapshot, RING, SLOT)?.hp,
      PROBE_HP - 1,
      "exactly one hit point removed",
    );
    const ball = res.snapshot.balls[0];
    assertDefined(ball, "the probing ball at the hit tick");
    assertBetween(
      ballPolar(ball).r,
      fig.contactInner + 0.5,
      fig.contactInner + 4.5,
      `the hit resolves at the inner contact radius (${fig.contactInner}) crossing`,
    );
  });
}
