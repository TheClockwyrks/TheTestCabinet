// modes/hundred-releases-one-hundred — the onslaught is exactly one hundred units,
// in one continuous wave.
//
// THE RULE. specs/modes.md, The Hundred: "It runs a single wave of exactly
// `HUNDRED_UNITS` (`100`) units, released at the same `WAVE_SPAWN_INTERVAL`
// cadence every wave uses", and "There is one untimed opening phase and no build
// phase between waves, because there is one wave." Its table gives the row a wave
// count of `1`.
//
// THE WORLD GATE IS OPENED, and this is one of the few points whose requirement IS
// the gate's subject. specs/instrumentation.md puts "the spawner's release of the
// units `wavePending` counts" behind `setWaveSpawning`, and what this point decides
// is how many units that spawner releases — so the gate is opened and the wave is
// begun by the player's own send, which specs/controls.md gives the effect "begins
// Wave 1 from the opening phase".
//
// THE COUNT IS THE ROSTER, BECAUSE EVERY UNIT IS HELD WHERE IT ARRIVED. The reason
// is in modes/run.ts and it is not a convenience: left walking, the first units
// reach their exhausts about fifteen seconds in, and twenty leaks take The
// Hundred's twenty lives to `0` and end the run less than half way through the
// release — so a build that releases its hundred correctly could never be seen
// doing it. Locomotion is a faculty this requirement does not exercise
// (specs/instrumentation.md gates it for exactly this), so it is held off, nothing
// leaves the floor, nothing ends the run, and the roster at the end of the window
// is the count the spawner released.
//
// THE WINDOW IS SEVENTY SECONDS, which is geometry rather than a tolerance: the
// hundredth unit is due `99 * 0.6` = `59.4` seconds in (specs/modes.md,
// specs/waves.md), so the window leaves better than ten seconds — more than
// seventeen further intervals — for a build that would release a hundred-and-first.
// A build releasing at a slower cadence than the specification's still gets its
// whole hundred out inside it.
//
// THREE READINGS, ONE PER CLAUSE. Exactly a hundred: the roster. And no more: the
// same roster, read ten seconds past the last release, with `wavePending` at `0` so
// nothing is still queued. In ONE CONTINUOUS WAVE: the phase never left `wave` and
// the wave number never left `1` across the whole window, which is what a build
// that split the onslaught into a second wave — or dropped a build phase into the
// middle of it — would fail.
//
// WHAT EVERY WRONG MODEL READS. A build that gives The Hundred the ordinary
// progression releases Wave 1's twelve Motes (specs/waves.md); one that reads the
// wave size off `WAVE_BASE_COUNT` for a cycling type releases between five and
// twenty-four; one that releases a hundred per TYPE releases five hundred; one that
// keeps going releases more than a hundred, and the window is long enough to see it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { captureStill, createHarness, seconds, type Harness } from "../harness";
import {
  beginOnslaught,
  ONSLAUGHT_TICKS,
  ONSLAUGHT_UNITS,
  RELEASE_INTERVAL,
  watchOnslaught,
} from "./run";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("releases exactly a hundred units, and no more, in one continuous wave", async () => {
  await beginOnslaught(h);
  assertEqual(
    h.snapshot().phase,
    "wave",
    "posing: the phase the send leaves the opening phase in (specs/waves.md)",
  );

  const watched = await watchOnslaught(h, ONSLAUGHT_TICKS);
  captureStill(h, "onslaught");

  const closed = h.snapshot();
  assertEqual(
    watched.released.length,
    ONSLAUGHT_UNITS,
    `the units The Hundred released over ${seconds(ONSLAUGHT_TICKS)} seconds, ` +
      `an onslaught paced at one every ${RELEASE_INTERVAL} seconds having its ` +
      "last due at 59.4 (specs/modes.md, The Hundred)",
  );
  assertEqual(
    closed.wavePending,
    0,
    "the units of the onslaught still queued for release once it is over " +
      "(specs/modes.md, The Hundred)",
  );
  assertTrue(
    watched.oneContinuousWave,
    `the phase holding at "wave" on wave 1 for the whole of the onslaught, ` +
      "The Hundred being one wave with no build phase between waves " +
      "(specs/modes.md, The Hundred)",
  );
});
