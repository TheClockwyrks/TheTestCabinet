// surge/vent-drawn-at-random — the release draws each unit's vent, so a wave
// uses both vents.
//
// THE RULE. specs/waves.md: "Each unit's vent is drawn at random as it is
// released, the two vents equally likely."
//
// WHAT IS READ. A forty-unit wave is released with no vent posed, and the vent
// of every unit is recorded the first time it is seen. Both vents must appear: a
// build that sends every unit through one vent is a completely different game,
// with one corridor to defend rather than two, and over forty draws at "equally
// likely" a draw that ever chose the other vent would have to be extraordinarily
// unlucky to hide it, one run in five hundred thousand million. Whether the two
// come up in the stated proportion is `surge/vents-equally-likely`'s item,
// decided on the draw alone.
//
// WAVE 4 IS THE ONE READ: specs/waves.md makes it a wave of forty units, the
// largest sample of draws the game offers before the milestone.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertGreaterThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  poseWaveReady,
  sizeOfWave,
  watchRelease,
  watchSecondsFor,
  wavesIn,
} from "./release";

/** The wave the draws are read on: the 20-wave run's forty-unit Swarm wave. */
const WAVE = 4;

/**
 * The fewest draws the reading is taken over.
 *
 * A precondition on the sample rather than an assertion about the wave's size,
 * which is `surge/wave-size`'s: over thirty draws, a fair draw shows both vents
 * with all but a thousand-millionth of certainty.
 */
const MIN_DRAWS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("uses both vents across a wave with no vent posed", async () => {
  poseWaveReady(h, WAVE);
  const released = await watchRelease(h, {
    seconds: watchSecondsFor(sizeOfWave(WAVE, wavesIn())),
  });
  captureStill(h, "vents");
  const vents = released.map((unit) => unit.vent);

  assertGreaterThanOrEqual(
    vents.length,
    MIN_DRAWS,
    `precondition: the units wave ${WAVE} released, each of which is one draw`,
  );
  assertContains(
    vents,
    "left",
    `the left vent among the vents drawn over ${vents.length} units ` +
      "(specs/waves.md: the two vents equally likely)",
  );
  assertContains(
    vents,
    "top",
    `the top vent among the vents drawn over ${vents.length} units ` +
      "(specs/waves.md: the two vents equally likely)",
  );
});
