// serve/wave-speed-cap — the wave ball speed caps at 480.
//
// specs/deflector-and-ball.md: "The ball speed of wave `w` is
// `240 + 30 * (w - 1)` units per second, capped at `480`." The formula meets
// the cap at wave 9; wave 12 is well past it, where the uncapped formula
// would say 570, so a serve there must leave at exactly 480.
//
// THE WORLD IS THE DEFLECTOR AND ITS PARKED BALL, per isolate().

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLength } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { readBall, unparked } from "./reading";

/** Past the cap point: the uncapped formula would serve this wave at 570. */
const WAVE = 12;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("serves a past-the-cap wave at exactly 480 units per second", async () => {
  isolate(h);
  h.debug.setWave(WAVE);
  h.debug.parkBall();

  const after = await captureReplay(h, "capped", async () => {
    h.debug.launchBall();
    return h.tick(1);
  });

  const flying = unparked(after);
  assertLength(flying, 1, "the served ball is the only ball");
  assertCloseTo(readBall(flying[0]).speed, 480, 2, "the capped serve speed");
});
