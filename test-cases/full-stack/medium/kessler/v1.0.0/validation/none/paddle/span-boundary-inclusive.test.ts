// paddle/span-boundary-inclusive — a ball crossing radius 194 inward with its
// center angle exactly at the span's edge, 24 degrees off the center angle at
// the baseline span, bounces.
//
// specs/field.md: "Angular membership, a ball or pod being within the
// deflector's span or a target's arc, is decided by the center point of the
// ball or pod, compared by wrap-aware circular distance, with the boundaries
// inclusive." The baseline span of 48 degrees (specs/field.md) puts each edge
// 24 degrees from the center, so a ball posed on the edge itself is within the
// span and specs/deflector-and-ball.md's crossing rule bounces it. Both edges
// are the same boundary rule read once each way, so they share this validator.
//
// The pose can place the edge only to float precision — the posed center angle
// reaches the build through cartesian coordinates and comes back through its
// own arctangent — so the pose stands EDGE_EPSILON_DEG inside the boundary,
// a hair far below any figure the specs state, rather than betting the point
// on the last bit of a roundtrip (the known-ambiguity rule for posed contact
// boundaries). What is decided is that membership reaches the edge itself to
// within that hair: a build whose span stops short of 24 degrees by any
// stated amount — a mis-derived half-span, an epsilon-shrunk comparison, a
// narrower span — fails at one edge or the other.
//
// THE WORLD IS ONE BALL AND THE DEFLECTOR at its start angle of 90, on an
// isolated field with nothing else to touch. The radial pose crosses strictly
// (197 before the crossing tick, 193 after), as the crossing items do.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, assertTrue } from "../assert";
import { ballSpeed, PADDLE_SPAN_BASE, PADDLE_START_ANGLE } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { ballRadial } from "./readings";

/** Posed start radius: crosses 194 strictly on the third tick. */
const START_RADIUS = 205;

/** Float headroom on the posed edge angle; no spec figure is this small. */
const EDGE_EPSILON_DEG = 1e-6;

/** The half-span each edge stands from the center at the baseline span. */
const HALF_SPAN_DEG = PADDLE_SPAN_BASE / 2;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Pose a ball dead on the given edge of the span and drive the crossing. */
async function crossesAtEdge(offsetDeg: number, outputId: string) {
  await isolate(h);
  const posedAngle = PADDLE_START_ANGLE + offsetDeg;
  await spawnBallPolar(h, START_RADIUS, posedAngle, ballSpeed(1), 180);

  const posed = await h.snapshot();
  assertLessThan(
    ballRadial(posed.balls[0]).vr,
    0,
    "the posed radial velocity, inward",
  );

  return captureReplay(h, outputId, () =>
    h.until((s) => s.balls.length === 1 && ballRadial(s.balls[0]).vr > 0, {
      maxTicks: 5,
    }),
  );
}

it("bounces a ball crossing at the span's rising edge", async () => {
  const swept = await crossesAtEdge(
    HALF_SPAN_DEG - EDGE_EPSILON_DEG,
    "edge-high",
  );
  assertTrue(swept.hit, "a bounce at the +24-degree edge of the span");
});

it("bounces a ball crossing at the span's falling edge", async () => {
  const swept = await crossesAtEdge(
    -(HALF_SPAN_DEG - EDGE_EPSILON_DEG),
    "edge-low",
  );
  assertTrue(swept.hit, "a bounce at the -24-degree edge of the span");
});
