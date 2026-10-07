// serve/launch-at-wave-speed — a launch serves at the current wave's ball
// speed.
//
// specs/deflector-and-ball.md: "Pressing `Space` launches the parked ball
// radially outward at the current wave's ball speed", and "The ball speed of
// wave `w` is `240 + 30 * (w - 1)` units per second" — so a wave-1 serve
// leaves at exactly 240. Read twice over: off the served ball's reported
// velocity, and off the radius its free flight actually covers, half a second
// of which is 120 units.
//
// THE WORLD IS THE DEFLECTOR AND ITS PARKED BALL on a fresh wave-1 session,
// per isolate().

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { readBall, unparked } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("serves a wave-1 ball at 240 units per second", async () => {
  const posed = isolate(h);
  assertEqual(posed.wave, 1, "the fresh session serves under wave 1");
  h.debug.parkBall();

  const { first, last } = await captureReplay(h, "serve-speed", async () => {
    h.debug.launchBall();
    return { first: await h.tick(1), last: await h.tick(29) };
  });

  const flying = unparked(first);
  assertLength(flying, 1, "the served ball is the only ball");
  assertCloseTo(
    readBall(flying[0]).speed,
    240,
    2,
    "the served speed, off the reported velocity",
  );
  assertCloseTo(
    readBall(unparked(last)[0]).r,
    194 + (240 * 30) / 60,
    1,
    "half a second of flight from radius 194 covers 120 units",
  );
});
