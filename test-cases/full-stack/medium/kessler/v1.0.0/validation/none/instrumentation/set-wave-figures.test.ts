// instrumentation/set-wave-figures — `setWave(n)` puts the wave-`n` figures in
// force.
//
// specs/instrumentation.md, on `setWave`: "Sets the wave counter to `n` ...
// and puts the wave-`n` figures in force: each ring's speed is set from the
// wave formulas of `specs/rings.md`, overwriting any `setRingSpeed`, and the
// wave ball speed used by a serve, a launch, and a paddle bounce becomes the
// wave-`n` figure of `specs/deflector-and-ball.md`." Those formulas: ring 2 at
// `+min(12 + 3 * (w - 1), 45)`, ring 3 at `-min(8 + 2 * (w - 1), 30)`, ring 1
// stationary, and the ball at `240 + 30 * (w - 1)` capped at `480`.
//
// A ring speed is posed to 77 first, so "overwriting any setRingSpeed" is read
// against a value that would otherwise survive, and the wave-4 ball speed is
// read off the game's own launch of a parked ball — the operation the spec
// names as a consumer of the figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { RING_FIGURES, speedOf, waveBallSpeed } from "./helpers";

/** The posed wave. */
const WAVE = 4;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sets the counter, the ring speeds, and the ball speed a launch uses", async () => {
  await isolate(h);
  await h.debug.setRingSpeed(2, 77);
  await h.debug.setWave(WAVE);
  const s = await h.snapshot();

  assertEqual(s.wave, WAVE, "the wave counter");
  for (const [i, figures] of RING_FIGURES.entries()) {
    assertCloseTo(
      s.rings[i].speedDegPerSec,
      figures.speedAtWave(WAVE),
      6,
      `ring ${i + 1}'s wave-${WAVE} orbit speed, the posed 77 overwritten`,
    );
  }

  const launched = await captureReplay(h, "launch", async () => {
    await h.debug.parkBall();
    await h.debug.launchBall();
    const at = await h.snapshot();
    await h.tick(12);
    return at;
  });

  assertEqual(launched.balls.length, 1, "the launched ball");
  assertEqual(launched.balls[0].parked, false, "launched off the deflector");
  assertCloseTo(
    speedOf(launched.balls[0]),
    waveBallSpeed(WAVE),
    3,
    `the launch serving the wave-${WAVE} ball speed`,
  );
});
