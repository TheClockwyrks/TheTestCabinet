// targets/edge-hit-by-ball-motion — a ball inside a ring's contact band whose
// own motion carries its center angle into a live arc scores an edge hit.
//
// WHAT THE SPECIFICATION FIXES. specs/rings.md: "Edge: in a tick where the
// ball's center radius lies between a ring's inner and outer contact radii,
// and the ball's center angle crosses into a live target's arc, the ball
// scores an edge hit on that target. The crossing is relative: the ball's
// motion, the ring's rotation, or both may produce it." — here the ring is
// frozen, so the ball's own motion is the crossing. "Each hit, face or edge,
// removes one hit point".
//
// THE READING BINDS THE BAND AS WELL AS THE HIT. The ball rides the ring's mid
// radius nearly tangentially, so at the hit tick its center radius sits deep
// inside the band, far from either contact radius — the hit can only be the
// angular crossing, never a face crossing.
//
// THE WORLD IS THE STATIONARY RING 1'S LONE TARGET AND ONE TANGENTIAL BALL,
// posed 1.15 degrees short of the arc's start edge so the crossing lands on
// the second tick with a clear margin either side of the inclusive boundary.

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

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("scores an edge hit when the ball's motion carries it into a live arc", async () => {
  await isolate(h);
  await freezeRing(h, RING, 0);
  const fig = figures(RING);
  await placeTarget(h, RING, SLOT, PROBE_HP);
  const midRadius = (fig.innerRadius + fig.outerRadius) / 2;

  const res = await captureReplay(h, "edge-hit", async () => {
    await ballAt(
      h,
      midRadius,
      arcStartDeg(RING, SLOT, 0) - 1.15,
      0,
      PROBE_SPEED,
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

  assertTrue(res.hit, "the angular crossing scores an edge hit");
  assertEqual(
    targetAt(res.snapshot, RING, SLOT)?.hp,
    PROBE_HP - 1,
    "exactly one hit point removed",
  );
  const ball = res.snapshot.balls[0];
  assertDefined(ball, "the probing ball at the hit tick");
  assertBetween(
    ballPolar(ball).r,
    fig.contactInner + 3,
    fig.contactOuter - 3,
    "the ball's center radius stayed inside the contact band — no face crossing",
  );
});
