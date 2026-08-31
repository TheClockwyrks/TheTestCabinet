// lives/clear-balls-costs-nothing — clearBalls removes every ball with no
// burn-up and no life lost.
//
// specs/instrumentation.md, on clearBalls: "Remove every ball, parked
// included. Nothing burns up, no life is lost." And the life-loss check of
// specs/field.md is a check on "this tick's burn-ups" — a field emptied by the
// pose has none, so the ticks that follow spend nothing and park nothing: the
// field stands without a ball until one is spawned or parked. Three balls are
// posed, the parked one included, so the removal is read against every kind
// the world holds.
//
// THE WORLD IS THE THREE BALLS. No targets or pods.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { START_LIVES } from "../constants";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { spawnBallRadial } from "./loss";

/** Ticks the emptied field is watched across. */
const WATCH_TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes every ball, spends no life, and leaves the field empty", async () => {
  await isolate(h);
  await h.debug.parkBall();
  await spawnBallRadial(h, 438, 0, 240);
  await spawnBallRadial(h, 300, 180, 240);
  const posed = await h.snapshot();
  assertLength(posed.balls, 3, "the posed balls, parked included");

  await h.debug.clearBalls();
  const cleared = await h.snapshot();
  assertLength(cleared.balls, 0, "no ball the moment after clearBalls");
  assertEqual(cleared.lives, START_LIVES, "no life lost at the call");

  const after = await h.tick(WATCH_TICKS);
  await captureStill(h, "cleared");

  assertEqual(after.lives, START_LIVES, "no life lost in the ticks after");
  assertLength(
    after.balls,
    0,
    "the field standing without a ball until one is spawned or parked",
  );
});
