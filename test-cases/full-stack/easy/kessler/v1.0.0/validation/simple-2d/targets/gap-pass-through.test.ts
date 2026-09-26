// targets/gap-pass-through — a ball whose center angle stays inside a
// structural gap crosses the ring untouched.
//
// WHAT THE SPECIFICATION FIXES. specs/rings.md: "These are the only target
// contacts, so a ball whose center angle stays inside a structural gap crosses
// the ring untouched." — no hit (no score), no reflection (the velocity
// stands), no hit point removed. The gap probed is the 4-degree seam between
// two adjacent slots' arcs — 2 degrees of trailing gap and 2 of leading gap —
// and the ball flies its center line, 2 degrees from each inclusive arc edge.
//
// THE WORLD IS THE STATIONARY RING 1 WITH BOTH NEIGHBOURING TARGETS LIVE and
// one radial ball down the seam: the two arcs the gap separates are exactly
// the targets a leaking membership test would hit.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDefined,
  assertEqual,
  assertLessThan,
} from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import {
  arcStartDeg,
  ballAt,
  ballPolar,
  figures,
  freezeRing,
  GAP_DEG,
  placeTarget,
  PROBE_HP,
  PROBE_SPEED,
  targetAt,
} from "./rig";

const RING = 1;
/** The seam probed: between slot 4's arc end and slot 5's arc start. */
const SLOT_BEFORE = 4;
const SLOT_AFTER = 5;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("passes a ball through a structural gap untouched", async () => {
  await isolate(h);
  await freezeRing(h, RING, 0);
  const fig = figures(RING);
  await placeTarget(h, RING, SLOT_BEFORE, PROBE_HP);
  await placeTarget(h, RING, SLOT_AFTER, PROBE_HP);
  // The slot boundary: 2 degrees past one arc's end, 2 before the next's start.
  const seamDeg = arcStartDeg(RING, SLOT_AFTER, 0) - GAP_DEG;

  const { posed, after } = await captureReplay(h, "pass", async () => {
    await ballAt(h, fig.contactOuter + 6, seamDeg, -PROBE_SPEED, 0);
    const posedBall = (await h.snapshot()).balls[0];
    // 13 ticks of 4 units inward: from 6 above the outer contact radius to
    // below the inner one, the whole band crossed inside the gap.
    const done = await h.tick(13);
    return { posed: posedBall, after: done };
  });

  assertDefined(posed, "the posed ball");
  const ball = after.balls[0];
  assertDefined(ball, "the ball after the crossing");
  if (posed === undefined || ball === undefined) return;
  assertLessThan(
    ballPolar(ball).r,
    fig.contactInner,
    "the ball crossed the whole ring band",
  );
  assertEqual(
    targetAt(after, RING, SLOT_BEFORE)?.hp,
    PROBE_HP,
    "no hit point removed from the target before the gap",
  );
  assertEqual(
    targetAt(after, RING, SLOT_AFTER)?.hp,
    PROBE_HP,
    "no hit point removed from the target after the gap",
  );
  assertEqual(after.score, 0, "no hit awarded");
  assertCloseTo(ball.vx, posed.vx, 3, "vx untouched — no reflection");
  assertCloseTo(ball.vy, posed.vy, 3, "vy untouched — no reflection");
});
