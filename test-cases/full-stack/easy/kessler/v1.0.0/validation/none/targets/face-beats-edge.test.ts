// targets/face-beats-edge — a tick where one target takes both a face and an
// edge crossing resolves as the face hit alone.
//
// WHAT THE SPECIFICATION FIXES. specs/rings.md: "A tick where the same target
// takes both a face and an edge crossing resolves as the face hit." — so one
// hit point removed, one hit awarded ("A hit that leaves the target alive:
// `50`", specs/scoring.md), and the reflection is a face contact's: the radial
// component reflected, then the pipeline of specs/deflector-and-ball.md.
//
// THE POSED TICK IS THE DOUBLE CROSSING. The ball starts just above the outer
// contact radius and just outside the arc's start edge, moving steeply inward
// with tangential motion, so ONE tick carries its center radius from above the
// outer contact radius to below it AND its center angle across the arc's edge
// into the arc. However a build reads the edge event's radius condition, the
// face crossing is present, so the tick must resolve as exactly one face hit —
// a build that resolves it as the edge hit shows a tangentially-reflected
// velocity, and a build that lands both removes two hit points.
//
// THE WORLD IS ONE FROZEN RING 2 TARGET AND ONE DIAGONAL BALL, switches off.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertLessThan,
  assertTrue,
} from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import {
  arcStartDeg,
  ballAt,
  expectedReflection,
  figures,
  freezeRing,
  HIT_AWARD,
  placeTarget,
  PROBE_HP,
  targetAt,
} from "./rig";

const RING = 2;
const SLOT = 3;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("resolves a same-tick face and edge crossing as the face hit alone", async () => {
  await isolate(h);
  await freezeRing(h, RING, 0);
  const fig = figures(RING);
  await placeTarget(h, RING, SLOT, PROBE_HP);

  const { posed, hit } = await captureReplay(h, "double", async () => {
    // 6 units inward and 10 tangential per tick: the first tick crosses the
    // outer contact radius (397 to ~391.1) AND carries the angle from 0.5
    // degrees outside the arc to ~0.97 inside it.
    await ballAt(
      h,
      fig.contactOuter + 5,
      arcStartDeg(RING, SLOT, 0) - 0.5,
      -360,
      600,
    );
    const posedBall = (await h.snapshot()).balls[0];
    const res = await h.until(
      (s) => {
        const t = targetAt(s, RING, SLOT);
        return t === undefined || t.hp < PROBE_HP;
      },
      { maxTicks: 4 },
    );
    await h.tick(6);
    return { posed: posedBall, hit: res };
  });

  assertTrue(hit.hit, "the double crossing lands a hit");
  assertEqual(
    targetAt(hit.snapshot, RING, SLOT)?.hp,
    PROBE_HP - 1,
    "exactly one hit point removed",
  );
  assertEqual(hit.snapshot.score, HIT_AWARD, "exactly one hit awarded");

  const ball = hit.snapshot.balls[0];
  assertDefined(ball, "the ball at the contact tick");
  assertDefined(posed, "the posed ball");
  if (ball === undefined || posed === undefined) return;
  const want = expectedReflection(ball, { vx: posed.vx, vy: posed.vy }, "face");
  assertLessThan(
    Math.hypot(ball.vx - want.vx, ball.vy - want.vy),
    2,
    "the outgoing velocity is the face contact's: radial component reflected, " +
      "arrival speed kept, then decayed toward the radial axis",
  );
});
