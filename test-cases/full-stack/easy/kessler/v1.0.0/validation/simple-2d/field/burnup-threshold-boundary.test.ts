// field/burnup-threshold-boundary — the burn-up threshold reads at exactly 78.
//
// specs/field.md fixes the figure twice: "Ball burn-up threshold | Ball center
// radius `78` or less" and "In a tick where a ball's center radius reaches
// `78` or less, the ball burns up". The two poses here bracket that figure
// with an honest 0.1-unit margin rather than landing a float exactly ON the
// boundary: a tick that carries the ball's center to about 77.9 must burn it,
// and a tick that carries it to about 78.1 must not.
//
// THE WORLD IS ONE BALL AND THE PLANET, per isolate(). A burn-up of the last
// ball may park a fresh ball inside the same tick, so the burned reading
// watches the UNPARKED ball.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLength } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { readBall, spawnAimed, unparked } from "./reading";

/** Straight-in dives at 4 units of radius per tick, six ticks to the read. */
const THETA = 250;
const SPEED = 240;
const TICKS = 6;
/** Lands the center at ~77.9 after six ticks: at or below the threshold. */
const BURN_FROM = 78 - 0.1 + (TICKS * SPEED) / 60;
/** Lands the center at ~78.1 after six ticks: just above the threshold. */
const HOLD_FROM = 78 + 0.1 + (TICKS * SPEED) / 60;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("burns up a ball carried to a center radius below 78", async () => {
  isolate(h);
  spawnAimed(h, BURN_FROM, THETA, SPEED, 180);

  const after = await captureReplay(h, "burns", () => h.tick(TICKS));

  assertLength(
    unparked(after),
    0,
    "a center radius of ~77.9 is at or below the threshold: burned up",
  );
});

it("keeps a ball holding a center radius just above 78", async () => {
  isolate(h);
  spawnAimed(h, HOLD_FROM, THETA, SPEED, 180);

  const after = await captureReplay(h, "holds", () => h.tick(TICKS));

  const balls = unparked(after);
  assertLength(balls, 1, "a center radius of ~78.1 is above the threshold");
  assertCloseTo(
    readBall(balls[0]).r,
    78.1,
    1,
    "the surviving ball holds its just-above-threshold radius",
  );
});
