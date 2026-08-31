// targets/no-repeat-without-crossing — a hit does not repeat while no fresh
// crossing occurs, however long the ball stays near the ring.
//
// WHAT THE SPECIFICATION FIXES. specs/rings.md: "A crossing is an event, so a
// contact repeats only after a fresh crossing." — restated by the item as "a
// ball that has scored a hit takes no further hit on later ticks while no
// fresh face or edge crossing occurs, however long its center radius stays
// near the ring."
//
// THE SCENARIO KEEPS THE BALL IN THE BAND. An edge hit is staged: the ball
// rides the ring's mid radius with a slight inward drift, crosses into the
// lone target's arc, and the tangential reflection sends its angle back OUT of
// the arc while its radius stays inside the contact band for the whole watch
// window. A build that re-detects overlap instead of crossings lands further
// hits on the ticks the ball is still inside the arc or the band; the spec's
// build removes exactly the first hit point and no more. The neighbouring
// slots are empty, so no legitimate fresh crossing can land during the window.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertDefined,
  assertEqual,
  assertTrue,
} from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import {
  arcStartDeg,
  ballAt,
  ballPolar,
  figures,
  freezeRing,
  placeTarget,
  PROBE_HP,
  PROBE_SPEED,
  targetAt,
} from "./rig";

const RING = 1;
const SLOT = 3;
/** Ticks watched after the hit, the ball lingering in the band throughout. */
const LINGER_TICKS = 14;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes no further hit after a scored hit until a fresh crossing", async () => {
  await isolate(h);
  await freezeRing(h, RING, 0);
  const fig = figures(RING);
  await placeTarget(h, RING, SLOT, PROBE_HP);
  const midRadius = (fig.innerRadius + fig.outerRadius) / 2;

  const { hit, rest } = await captureReplay(h, "linger", async () => {
    await ballAt(
      h,
      midRadius,
      arcStartDeg(RING, SLOT, 0) - 1.15,
      -20,
      PROBE_SPEED,
    );
    const first = await h.until(
      (s) => {
        const t = targetAt(s, RING, SLOT);
        return t === undefined || t.hp < PROBE_HP;
      },
      { maxTicks: 10 },
    );
    const after = await h.tick(LINGER_TICKS);
    return { hit: first, rest: after };
  });

  assertTrue(hit.hit, "the staging edge hit lands");
  assertEqual(
    targetAt(rest, RING, SLOT)?.hp,
    PROBE_HP - 1,
    `no further hit point removed across ${LINGER_TICKS} lingering ticks`,
  );
  const ball = rest.balls[0];
  assertDefined(ball, "the lingering ball");
  if (ball === undefined) return;
  assertBetween(
    ballPolar(ball).r,
    fig.contactInner,
    fig.contactOuter,
    "the ball's center radius stayed near the ring the whole window",
  );
});
