// pods/spawns-at-arc-center — a shed pod spawns at its ring's mid radius, at
// the destroyed target's arc-center angle as the ring stands posed.
//
// specs/pods.md: "A shed pod spawns at its ring's mid radius, at the destroyed
// target's arc-center angle as the ring stands posed on the destruction tick",
// with the mid radii tabled 302 / 372 / 442. Read on the destruction tick's
// own snapshot — pods advance before balls resolve (specs/field.md's tick
// order), so the tick that sheds shows the pod exactly where it spawned. Both
// a ring-1 and a ring-3 destruction are posed, each under a NON-ZERO posed
// ring angle, so a build that sheds at the slot's wave-start angle rather than
// the posed one misses by the posed rotation. Position is a spawn point, not a
// contact boundary, so the tolerance is a twentieth of a unit and of a degree.
//
// THE WORLD IS ONE TARGET AND ONE BALL PER DRAW, staged by the shared draw
// helper on a frozen ring with the deflector parked away; the seed (9) sheds
// on both of its first two draws.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLength, assertTrue } from "../assert";
import {
  POD_DROP_CHANCE,
  RINGS,
  angularOffset,
  mulberry32,
  polarOf,
  slotArcCenterDeg,
} from "../constants";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { AWAY_ANGLE, destroyPosedTarget } from "./draw";

/** mulberry32(9) sheds on each of its first two draws (0.1987, then 0.0937). */
const SEED = 9;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spawns the shed pod at the mid radius and posed arc center", async () => {
  const next = mulberry32(SEED);
  assertTrue(next() < POD_DROP_CHANCE, "the first draw sheds");
  next();
  assertTrue(next() < POD_DROP_CHANCE, "the second draw sheds");

  await isolate(h, SEED);
  await h.debug.setPodSpawn(true);
  await h.debug.setPaddleAngle(AWAY_ANGLE);

  // Ring 1, slot 3, posed to ring angle 40: arc center 145, mid radius 302.
  const ring1 = await captureReplay(h, "spawn-ring1", () =>
    destroyPosedTarget(h, 1, 3, 40),
  );
  assertLength(ring1.pods, 1, "the ring-1 destruction sheds");
  const p1 = polarOf(ring1.pods[0].x, ring1.pods[0].y);
  assertCloseTo(p1.r, RINGS[0].podSpawnRadius, 1, "the ring-1 mid radius");
  assertCloseTo(
    angularOffset(slotArcCenterDeg(1, 3, 40), p1.theta),
    0,
    1,
    "the destroyed target's arc-center angle under ring angle 40",
  );
  await h.debug.clearPods();

  // Ring 3, slot 0, posed to ring angle 200: arc center 209, mid radius 442.
  const ring3 = await captureReplay(h, "spawn-ring3", () =>
    destroyPosedTarget(h, 3, 0, 200),
  );
  assertLength(ring3.pods, 1, "the ring-3 destruction sheds");
  const p3 = polarOf(ring3.pods[0].x, ring3.pods[0].y);
  assertCloseTo(p3.r, RINGS[2].podSpawnRadius, 1, "the ring-3 mid radius");
  assertCloseTo(
    angularOffset(slotArcCenterDeg(3, 0, 200), p3.theta),
    0,
    1,
    "the destroyed target's arc-center angle under ring angle 200",
  );
});
