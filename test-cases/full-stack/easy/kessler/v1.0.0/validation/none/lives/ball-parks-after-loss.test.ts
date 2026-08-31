// lives/ball-parks-after-loss — a loss that leaves lives parks a fresh ball on
// the deflector.
//
// specs/field.md, in the life-loss check: "With lives remaining, a new ball
// parks on the deflector as `specs/deflector-and-ball.md` states" — and that
// file poses the park: "A parked ball sits at radius `194` at the deflector's
// center angle", listing "after a life loss that leaves lives remaining" among
// the moments a ball parks. The watch stops on the tick lives fall, and on
// that very tick the world already holds one parked ball at 194 on the
// deflector's angle — the same-tick park is what keeps play continuable. The
// position tolerance is float dust: the park's figures are exact.
//
// THE WORLD IS THE ONE DOOMED BALL. The deflector stands untouched at its
// starting 90, so the parked angle is read against a posed figure.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import { START_LIVES } from "../constants";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import {
  ballPolar,
  DEFLECTOR_START_DEG,
  DOOM_TICKS,
  PARK_RADIUS,
  spawnDoomedBall,
} from "./loss";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("parks a new ball on the deflector on the loss tick", async () => {
  await isolate(h);
  await spawnDoomedBall(h);

  const run = await captureReplay(h, "re-park", () =>
    h.until((s) => s.lives !== START_LIVES, { maxTicks: DOOM_TICKS }),
  );

  assertTrue(run.hit, "a life loss within the fall's ticks");
  const s = run.snapshot;
  assertEqual(s.lives, START_LIVES - 1, "a loss that leaves lives remaining");
  assertLength(s.balls, 1, "one fresh ball in the world on the loss tick");
  assertEqual(s.balls[0].parked, true, "the fresh ball is parked");

  const at = ballPolar(s.balls[0]);
  assertCloseTo(at.r, PARK_RADIUS, 3, "the parked ball's radius");
  assertCloseTo(
    at.theta,
    DEFLECTOR_START_DEG,
    3,
    "the parked ball on the deflector's center angle",
  );
});
