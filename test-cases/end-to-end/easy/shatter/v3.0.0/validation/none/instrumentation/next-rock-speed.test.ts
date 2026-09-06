// instrumentation/next-rock-speed — `setNextRockSpeed` decides the base drift
// speed of every rock the next placement puts up, and the placement consumes it.
//
// THE RULE. `specs/instrumentation.md`, "Posed draws": `setNextRockSpeed(speed)`
// "poses the base drift speed, in logical units per second, that every rock of the
// next placement takes: the rocks of the next wave the game spawns, or the next
// rock the star recycles, whichever comes first", reported as `nextRockSpeed`.
//
// THE PLACEMENT READ IS A WAVE, AT WAVE 1, where `specs/progression.md`'s
// multiplier is exactly `1`, so what every rock arrives at is the posed figure
// itself; the multiplier is `waves/speed-scales-per-wave`'s item, and the recycle
// is `instrumentation/next-recycle-edge`'s ground. The wave is put up the way
// `setWaveBanner` puts one up: a posed banner runs down and spawns the wave its
// number names. Every rock is read on the tick the wave arrived.
//
// THE TOLERANCE is two units per second: the at-most one tick of the well inside
// a reading, worth under `0.94` at the closest a wave may spawn to the star, and
// float rounding. The range `specs/rocks.md` draws from is fifty units wide, so a
// build that ignores the pose lands every rock inside the band with probability
// under one in a hundred thousand.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { WAVE_BANNER_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The posed base: inside the Large range, and not one of its ends. */
const POSED_SPEED = 100;

/** How far a rock's speed may stand from the posed base. See the header. */
const SPEED_TOLERANCE = 2;

/** The banner posed: a tenth of a second, so the wave is a dozen ticks away. */
const BANNER = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives every rock of the next wave the posed base speed and consumes the pose", async () => {
  await startPlaying(h, { wave: 1 });
  await h.debug.setWaveSpawning(true);
  await h.debug.setNextRockSpeed(POSED_SPEED);
  assertEqual(
    (await h.snapshot()).nextRockSpeed,
    POSED_SPEED,
    "setNextRockSpeed read back before the placement (specs/instrumentation.md)",
  );

  await h.debug.setWaveBanner(BANNER);
  const arrival = await h.skipUntil((snapshot) => snapshot.rocks.length > 0, {
    poll: 1,
    maxTicks: ticksFor(BANNER + WAVE_BANNER_TIME),
  });
  await captureStill(h, "posed");
  assertEqual(
    arrival.hit,
    true,
    "the wave a posed banner announces arriving as the banner ends (specs/instrumentation.md)",
  );
  assertGreaterThan(arrival.snapshot.rocks.length, 0, "rocks the wave put up");

  for (const [index, rock] of arrival.snapshot.rocks.entries()) {
    assertLessThanOrEqual(
      Math.abs(Math.hypot(rock.vx, rock.vy) - POSED_SPEED),
      SPEED_TOLERANCE,
      `rock ${index + 1} of the wave drifting at the posed base ${POSED_SPEED} at wave 1 (specs/instrumentation.md)`,
    );
  }
  assertEqual(
    arrival.snapshot.nextRockSpeed,
    null,
    "nextRockSpeed once the placement has consumed it (specs/instrumentation.md)",
  );
});
