// lives/not-lost-with-balls-left — a burn-up spends no life while any live
// ball remains.
//
// specs/field.md ties the loss to "the last live ball", and
// specs/deflector-and-ball.md makes the parked ball part of that count: "A
// parked ball is live: it counts toward the ball cap and is drawn like any
// other ball." So one ball burns while another remains — once the parked ball
// itself, the stated edge, and once a ball in flight — and in both worlds the
// lives figure stands untouched through the burn-up and the ticks around it.
//
// THE WORLD IS TWO BALLS. No targets or pods; the survivor is posed where the
// doomed ball's fall and its own path never meet another surface check's
// territory — the parked ball rides the deflector, the flying one bounces off
// the containment field far above the planet.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { START_LIVES } from "../constants";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { spawnBallRadial, spawnDoomedBall } from "./loss";

/** Ticks that cover the 18-tick fall with slack, well short of the survivor. */
const WATCH_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h.dispose();
});

it("costs nothing while the parked ball remains", async () => {
  isolate(h);
  h.debug.parkBall();
  spawnDoomedBall(h);
  const posed = h.snapshot();
  assertLength(posed.balls, 2, "the doomed ball and the parked one");

  const after = await captureReplay(h, "parked-remains", () =>
    h.tick(WATCH_TICKS),
  );

  assertEqual(after.lives, START_LIVES, "lives after the burn-up: untouched");
  assertLength(after.balls, 1, "the parked ball still live");
  assertEqual(after.balls[0].parked, true, "the survivor is the parked ball");
});

it("costs nothing while a ball in flight remains", async () => {
  isolate(h);
  // The survivor: outbound at 438, it meets only the containment field and
  // falls back far above the planet for hundreds of ticks.
  spawnBallRadial(h, 438, 0, 240);
  spawnDoomedBall(h);
  const posed = h.snapshot();
  assertLength(posed.balls, 2, "the doomed ball and the survivor");

  const after = await captureReplay(h, "flight-remains", () =>
    h.tick(WATCH_TICKS),
  );

  assertEqual(after.lives, START_LIVES, "lives after the burn-up: untouched");
  assertLength(after.balls, 1, "the surviving ball still in flight");
  assertEqual(after.balls[0].parked, false, "the survivor flies unparked");
});
