// lives/lost-on-last-ball — burning up the last live ball costs exactly one
// life.
//
// specs/field.md: "After step 5, if this tick's burn-ups removed the last live
// ball, one life is lost: `lives` falls by `1`". One ball is posed falling
// radially onto the planet, so its burn-up (center radius 78 or less) is the
// tick's only event; the watch stops at the first tick the lives figure moves,
// and the verdict is that it moved to exactly one less — a build spending two
// lives, or a fractional one, fails the same reading.
//
// THE WORLD IS THE ONE DOOMED BALL. No targets, pods, or second ball: whether
// company spares the life is lives/not-lost-with-balls-left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { START_LIVES } from "../constants";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { DOOM_TICKS, spawnDoomedBall } from "./loss";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h.dispose();
});

it("lowers lives by exactly 1 when the last ball burns up", async () => {
  isolate(h);
  spawnDoomedBall(h);
  const posed = h.snapshot();
  assertEqual(posed.lives, START_LIVES, "the posed lives");
  assertLength(posed.balls, 1, "the one ball whose loss is watched");

  const run = await captureReplay(h, "burn-up", () =>
    h.until((s) => s.lives !== START_LIVES, { maxTicks: DOOM_TICKS }),
  );

  assertTrue(run.hit, "a life loss within the fall's ticks");
  assertEqual(
    run.snapshot.lives,
    START_LIVES - 1,
    "lives after the last ball burned up: exactly one less",
  );
});
