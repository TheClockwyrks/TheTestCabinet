// field/containment-outward-gate — only the outward crossing is a containment
// contact.
//
// specs/field.md fires the containment reflection "in a tick where a ball's
// center radius moves from below `472` to `472` or above with outward radial
// velocity (`v . n > 0`)". A ball posed beyond 472 moving INWARD makes the
// opposite crossing, which the rule does not name, so the ball re-enters play
// unchanged: same velocity, no reflection, no pipeline.
//
// THE WORLD IS ONE BALL AND THE FIELD. isolate() empties everything else, and
// the inbound line at this angle meets nothing before the read: the deflector
// stands at its start angle 90, far outside the span of a ball at angle 200.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLength, assertLessThan } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { readBall, spawnAimed, unparked } from "./reading";

/** Posed beyond the 472 contact radius, heading straight inward. */
const POSE = { r: 479, thetaDeg: 200, speed: 240, offDeg: 180 };

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("crosses 472 inward without reflecting", async () => {
  isolate(h);
  spawnAimed(h, POSE.r, POSE.thetaDeg, POSE.speed, POSE.offDeg);

  const posed = readBall(h.snapshot().balls[0]);
  assertLessThan(posed.vr, 0, "the posed ball moves inward");

  // 240 units per second is 4 units of radius per tick: 479 to about 475,
  // 471, 467 — the inward crossing of 472 resolves between the first and
  // second of these three ticks.
  const after = await captureReplay(h, "reentry", () => h.tick(3));

  const balls = unparked(after);
  assertLength(balls, 1, "the ball is still in play");
  const read = readBall(balls[0]);
  assertCloseTo(read.r, 467, 2, "three ticks of unbroken inward travel");
  assertCloseTo(read.vr, -240, 3, "the inward radial velocity is unchanged");
  assertCloseTo(read.vt, 0, 3, "no tangential velocity appeared");
});
