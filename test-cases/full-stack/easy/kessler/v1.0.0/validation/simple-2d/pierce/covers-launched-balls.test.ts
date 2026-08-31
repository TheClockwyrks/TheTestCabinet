// pierce/covers-launched-balls — a ball launched while pierce is in force
// pierces like the balls that were flying at the catch.
//
// specs/pods.md, "pierce": "While pierce is in force every ball pierces,
// balls served or launched during it included." The scenario arms pierce
// FIRST and only then parks and launches a ball down a frozen full-hit-point
// ring 2 target's arc, so the one contact that follows is made by a ball that
// did not exist when the effect began — and it must still destroy the
// 2-hit-point target outright, exactly as pierce/destroys-outright reads it
// for a ball that predated the effect.
//
// THE WORLD IS ONE TARGET AND ONE LAUNCHED BALL, per isolate(). The launch
// serves from radius 194 at the wave-1 speed (4 units per tick), so the
// crossing of contact radius 352 resolves on tick 40 (350 to 354), strictly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  armPierce,
  parkAndLaunch,
  PIERCE_DURATION,
  poseIsolated,
  poseRingTwoTarget,
  ringTwoTarget,
  soleBall,
} from "./stage";

/** The ring 2 slot the target is posed in. */
const SLOT = 5;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a ball launched mid-effect destroys a full-hit-point target outright", async () => {
  await poseIsolated(h);
  await armPierce(h, PIERCE_DURATION);
  const arcDeg = await poseRingTwoTarget(h, SLOT, { hp: 2, freeze: true });
  const launched = await parkAndLaunch(h, arcDeg);

  const ball = soleBall(launched);
  assertEqual(ball.parked, false, "the launch set the ball flying");
  assertEqual(
    ball.piercing,
    true,
    "a ball launched while pierce is in force pierces",
  );

  const after = await captureReplay(h, "launched", () => h.tick(41)); // the crossing of 352 resolves on tick 40

  assertUndefined(
    ringTwoTarget(after, SLOT),
    "the 2-hit-point target, destroyed outright by the launched ball",
  );
});
