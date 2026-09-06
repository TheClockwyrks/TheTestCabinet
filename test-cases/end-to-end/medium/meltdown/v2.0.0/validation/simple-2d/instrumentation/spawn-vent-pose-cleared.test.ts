// Meltdown — instrumentation/spawn-vent-pose-cleared: `setSpawnVent(null)`
// returns the release to its own draw.
//
// specs/instrumentation.md: "while it holds `null` the spawner draws as it does
// in play", and specs/waves.md: "Each unit's vent is drawn at random as it is
// released, the two vents equally likely."
//
// TWO LEGS OF ONE WAVE. The wave opens with the left vent posed, and the first
// few releases are read as the precondition that the pose held. The pose is then
// cleared MID-RELEASE, `spawnVent` is read back as `null`, and a handful more
// units are released: each of them enters at a vent the specification names, so
// a build that treats `null` as a vent, or that stops releasing once the pose is
// gone, is named. Which vent each draw lands on is the draw's own; whether the
// draw varies and at what odds are `surge/vent-drawn-at-random` and
// `surge/vents-equally-likely`, decided on the draw alone.
//
// THE UNITS ARE GATHERED AS THEY ARRIVE, and a unit is counted where it entered.
// The wave is the twelve-Mote first wave, and the watch stops as soon as it has
// the units it reads, so nothing walks far enough to leak.

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
import { poseWaveReady, watchRelease, watchSecondsFor } from "../surge/release";

/** The wave released: the first wave of a run, twelve Motes. */
const WAVE = 1;

/** The two vents the specification allows a released unit. */
const VENTS = ["left", "top"] as const;

/** How many units are released under the pose before it is cleared. */
const POSED_UNITS = 4;

/** How many units are read after the pose is cleared. */
const DRAWN_UNITS = 6;

/** Frames between two samples of the second leg: a third of the cadence. */
const POLL = ticksFor(WAVE_SPAWN_INTERVAL / 3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws each unit's vent again once the pose is cleared", async () => {
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

  // The next few units, each recorded the first time it is seen.
  const seen = new Set(posed.map((unit) => unit.id));
  const vents: VentName[] = [];
  const frames = ticksFor(watchSecondsFor(DRAWN_UNITS + 1));
  for (
    let done = 0;
    done < frames && vents.length < DRAWN_UNITS && h.snapshot().wavePending > 0;
  ) {
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
    DRAWN_UNITS,
    "the units released after the pose was cleared " +
      "(specs/instrumentation.md: the spawner draws as it does in play)",
  );
  for (const [index, vent] of vents.entries()) {
    assertContains(
      VENTS,
      vent,
      `unit ${index + 1} after the pose was cleared: the vent it entered at ` +
        "(specs/instrumentation.md: the spawner draws as it does in play)",
    );
  }
});
