// Meltdown — instrumentation/spawn-vent-pose-cleared: `setSpawnVent(null)`
// returns the release to its own draw.
//
// THE RULE. `specs/instrumentation.md`: "while it holds `null` the spawner
// draws as it does in play", and `specs/waves.md`: "Each unit's vent is drawn
// at random as it is released, the two vents equally likely."
//
// TWO LEGS OF ONE WAVE. The wave opens with the left vent posed, and the first
// few releases are read as the precondition that the pose held. The pose is then
// cleared MID-RELEASE, `spawnVent` is read back as `null`, and a handful more
// units are released: each of them enters at a vent the specification names, so
// a build that treats `null` as a vent, or that stops releasing once the pose is
// gone, is named. Which vent each draw lands on is the draw's own; that the draw
// varies at all is `surge/vent-drawn-at-random`, decided on the draw alone.
//
// THE UNITS ARE GATHERED AS THEY ARRIVE, and a unit is counted where it entered.
// The wave is the twelve-Mote first wave, and each watch stops as soon as it has
// the units it reads, so nothing walks far enough to leak.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import { WAVE_SPAWN_INTERVAL } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openWave, watchRelease } from "../surge/roster";

/** The wave released: the first wave of a run, twelve Motes. */
const WAVE = 1;

/** The two vents the specification allows a released unit. */
const VENTS = ["left", "top"] as const;

/** How many units are released under the pose before it is cleared. */
const POSED_UNITS = 4;

/** How many units are read after the pose is cleared. */
const DRAWN_UNITS = 6;

/**
 * Seconds of game time each leg may run for: the cadence of the units it
 * expects with a whole interval over, for a build whose release clock runs a
 * little slow. Each watch stops as soon as it has read its units, so the ceiling
 * is what a build that stopped releasing runs out.
 */
const POSED_SECONDS = (POSED_UNITS + 1) * WAVE_SPAWN_INTERVAL;
const DRAWN_SECONDS = (DRAWN_UNITS + 1) * WAVE_SPAWN_INTERVAL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws each unit's vent again once the pose is cleared", async () => {
  await openWave(h, WAVE, "medium", async () => {
    await h.debug.setSpawnVent("left");
  });
  const posed = await watchRelease(h, POSED_SECONDS, POSED_UNITS);
  assertGreaterThanOrEqual(
    posed.length,
    POSED_UNITS,
    "precondition: units released while the left vent was posed",
  );
  assertDeepEqual(
    [...new Set(posed.map((arrival) => arrival.vent))],
    ["left"],
    "precondition: the vents of the units released under the pose",
  );

  await h.debug.setSpawnVent(null);
  assertEqual(
    (await h.snapshot()).spawnVent,
    null,
    "the vent pose, read back as spawnVent after setSpawnVent(null)",
  );
  // A fresh watch counts everything standing as an arrival, so the units the
  // posed leg released are set aside by id.
  const already = new Set(posed.map((arrival) => arrival.id));
  const drawn = await watchRelease(
    h,
    DRAWN_SECONDS,
    already.size + DRAWN_UNITS,
  );
  await captureStill(h, "resumed");

  const vents = drawn
    .filter((arrival) => !already.has(arrival.id))
    .map((arrival) => arrival.vent);
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
