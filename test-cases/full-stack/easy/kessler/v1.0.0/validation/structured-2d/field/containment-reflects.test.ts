// field/containment-reflects — the containment field reflects an outbound ball
// as a face contact.
//
// specs/field.md: "In a tick where a ball's center radius moves from below
// `472` to `472` or above with outward radial velocity (`v . n > 0`), the ball
// reflects off the containment field. The reflection is a face contact
// resolved by the reflection pipeline in specs/deflector-and-ball.md", whose
// step 1 is "A face contact reflects the radial component:
// `v' = v - 2 (v . n) n`" — the radial component reversed, the tangential
// component kept.
//
// THE READING TOLERATES THE PIPELINE'S LATER STEPS. The same pipeline lawfully
// rotates the reflected velocity up to 6 degrees toward the radial (orbital
// decay, its own review item), so the face-contact reading here is an
// envelope: a ball arriving 30 degrees off the outward radial must leave
// between 30 and 30 - 6 = 24 degrees off the INWARD radial, on the SAME
// tangential sign. A build that reflected the tangential component instead
// (an edge-style contact, or v -> -v) lands on the opposite sign and fails.
// The envelope carries a further half degree to each side: the radial axis is
// read "at the ball's center", and the center's angle moves about a third of
// a degree across the crossing tick, so where within the tick a build
// evaluates the axis moves the reading by that much.
//
// THE WORLD IS ONE BALL AND THE FIELD. isolate() empties the rings, balls, and
// pods and holds both driver switches, so the only contact a tick can resolve
// is the containment crossing this item is about.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertGreaterThan,
  assertLength,
  assertLessThan,
} from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { readBall, spawnAimed, unparked } from "./reading";

/** Where the ball is posed: below 472, crossing it on the first tick. */
const POSE = { r: 470, thetaDeg: 40, speed: 240, offDeg: 30 };

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reflects the outbound crossing as a face contact", async () => {
  isolate(h);
  spawnAimed(h, POSE.r, POSE.thetaDeg, POSE.speed, POSE.offDeg);

  const posed = readBall(h.snapshot().balls[0]);
  assertGreaterThan(posed.vr, 0, "the posed ball moves outward");

  // 240 units per second, 30 degrees off the radial, is about 3.5 units of
  // radius per tick: the crossing from 470 past 472 resolves on this tick.
  const after = await captureReplay(h, "reflect", () => h.tick(1));

  const balls = unparked(after);
  assertLength(balls, 1, "the one posed ball is still the only ball");
  const read = readBall(balls[0]);
  assertLessThan(read.vr, 0, "the radial velocity component is reversed");
  assertGreaterThan(read.vt, 0, "the tangential component keeps its sign");
  assertBetween(
    read.offInwardDeg,
    -30.5,
    -23.5,
    "the outgoing heading, off the inward radial: the specular reflection " +
      "of a 30-degree arrival, less at most the pipeline's 6 degrees of decay",
  );
});
