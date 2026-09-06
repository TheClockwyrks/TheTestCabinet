// Meltdown — instrumentation/spawn-vent-pose-cleared: `setSpawnVent(null)`
// returns the release to its own draw.
//
// specs/instrumentation.md: "while it holds `null` the spawner draws as it does
// in play", and specs/waves.md: "Each unit's vent is drawn at random as it is
// released, the two vents equally likely."
//
// TWO LEGS OF ONE WAVE. The wave opens with the left vent posed, and the first
// few releases are read as the precondition that the pose held. The pose is then
// cleared MID-RELEASE, and the rest of the wave is watched: a draw at "equally
// likely" over the thirty-odd units left puts both vents on the floor with a
// probability short of certainty by less than one part in a thousand million, so
// a build whose clear does nothing — every later unit still entering on the left
// — is named, and so is a build that treats `null` as a vent.
//
// THE UNITS ARE GATHERED AS THEY ARRIVE, because an undefended floor leaks them
// again long before the wave is out, and a unit is counted where it entered.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import { WAVE_SPAWN_INTERVAL } from "../constants";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
  type VentName,
} from "../harness";
import {
  poseWaveReady,
  sizeOfWave,
  watchRelease,
  watchSecondsFor,
  wavesIn,
} from "../surge/release";

/** The wave released: wave 4 of a twenty-wave run, forty Swarms. */
const WAVE = 4;

/** How many units are released under the pose before it is cleared. */
const POSED_UNITS = 4;

/**
 * The fewest units the second leg must read for the draw to be decidable.
 *
 * A precondition on the sample: over thirty draws at "equally likely", both vents
 * appear with all but a thousand-millionth of certainty. How many the wave
 * releases is `surge/wave-size`'s item.
 */
const MIN_DRAWN = 30;

/** Frames between two samples of the second leg: a third of the cadence. */
const POLL = ticksFor(WAVE_SPAWN_INTERVAL / 3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws both vents again once the pose is cleared", async () => {
  poseWaveReady(h, WAVE);
  h.debug.setSpawnVent("left");
  const posed = await watchRelease(h, {
    stopAfter: POSED_UNITS,
    seconds: watchSecondsFor(POSED_UNITS),
  });
  assertGreaterThanOrEqual(
    posed.length,
    POSED_UNITS,
    "precondition: units released while the left vent was posed",
  );
  assertDeepEqual(
    [...new Set(posed.map((unit) => unit.vent))],
    ["left"],
    "precondition: the vents of the units released under the pose",
  );

  h.debug.setSpawnVent(null);
  assertEqual(
    h.snapshot().spawnVent,
    null,
    "the vent pose, read back as spawnVent after setSpawnVent(null)",
  );

  // The rest of the wave, each unit recorded the first time it is seen.
  const seen = new Set(posed.map((unit) => unit.id));
  const vents: VentName[] = [];
  const remaining = sizeOfWave(WAVE, wavesIn()) - posed.length;
  const frames = ticksFor(watchSecondsFor(remaining));
  for (let done = 0; done < frames && h.snapshot().wavePending > 0; ) {
    const step = Math.min(POLL, frames - done);
    await h.advance(step);
    done += step;
    for (const unit of h.snapshot().surge) {
      if (seen.has(unit.id)) continue;
      seen.add(unit.id);
      vents.push(unit.vent);
    }
  }
  captureStill(h, "resumed");

  assertGreaterThanOrEqual(
    vents.length,
    MIN_DRAWN,
    "precondition: units released after the pose was cleared",
  );
  assertContains(
    vents,
    "left",
    `the vents of ${vents.length} units released after the pose was cleared ` +
      "(specs/instrumentation.md: the spawner draws as it does in play)",
  );
  assertContains(
    vents,
    "top",
    `the vents of ${vents.length} units released after the pose was cleared ` +
      "(specs/instrumentation.md: the spawner draws as it does in play)",
  );
});
