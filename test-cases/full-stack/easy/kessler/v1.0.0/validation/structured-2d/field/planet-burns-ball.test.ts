// field/planet-burns-ball — the planet burns up a ball that reaches it.
//
// specs/field.md: "In a tick where a ball's center radius reaches `78` or
// less, the ball burns up: it is removed". The removal is the whole reading
// here — the threshold's exact figure is the burnup-threshold-boundary item,
// and the life-loss consequences are the field's life-loss check, items of
// their own.
//
// THE WORLD IS ONE BALL AND THE PLANET, per isolate(). The same life-loss
// check may park a FRESH ball on the deflector inside the burn-up's own tick
// ("a new ball parks on the deflector"), so the read watches for the posed
// UNPARKED ball to be gone rather than for balls to be empty.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertLessThan, assertTrue } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { readBall, spawnAimed, unparked } from "./reading";

/** Diving straight at the planet from just outside the burn-up band. */
const POSE = { r: 100, thetaDeg: 120, speed: 240, offDeg: 180 };

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes a ball whose radius reaches the burn-up threshold", async () => {
  isolate(h);
  spawnAimed(h, POSE.r, POSE.thetaDeg, POSE.speed, POSE.offDeg);

  const posed = unparked(h.snapshot());
  assertLength(posed, 1, "the posed inbound ball");
  assertLessThan(readBall(posed[0]).vr, 0, "the posed ball moves inward");

  // 240 units per second inward is 4 units of radius per tick: from 100 the
  // ball's center reaches 78 or less on the sixth tick. The sweep only reads;
  // the ticks decide when the burn-up resolves.
  const gone = await captureReplay(h, "burnup", () =>
    h.until((s) => unparked(s).length === 0, { maxTicks: 30 }),
  );

  assertTrue(gone.hit, "the ball that reached the planet was removed");
});
