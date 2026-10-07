// surge/wave-type-opening — waves 1 through 8 field the types `WAVE_OPENING`
// lists, in order.
//
// THE RULE. specs/waves.md, What a wave carries:
//
//   waveType(w, n) = ... WAVE_OPENING[w - 1] if w <= 8 ...
//   WAVE_OPENING = [mote, mote, sprint, swarm, mote, drift, mote, hulk]
//
// so the first eight waves of a run carry Mote, Mote, Sprint, Swarm, Mote, Drift,
// Mote, Hulk. In the 20-wave Containment run this point drives, the two milestone
// waves are `10` and `20`, so nothing overrides any of the eight.
//
// EVERY WAVE IS READ, NOT A SAMPLE OF THEM. The list is eight independent entries
// with no formula behind it, so a build that got seven of them right and one wrong
// is exactly the defect this point exists to name, and each failure carries its own
// wave number. Waves 1, 2, 5 and 7 all read Mote and a build that returned Mote for
// everything would pass four of the eight; the other four are what fail it.
//
// THE TYPE IS READ OFF THE UNIT THE RUN RELEASED, not off any field that reports a
// wave's composition. `nextWave.type` is what the build SAYS the coming wave holds
// and the `hud` group decides whether it says it truthfully; what this point is
// about is what actually walked out of the vent. So the world gate goes on, the
// wave is begun with the send key, and the arrival is read (surge/release.ts).
//
// ONLY THE FIRST ARRIVAL IS READ, because "each wave fields a single type" is a
// separate requirement with a separate point — `single-type-waves` — and reading a
// whole wave here would fold the two together. One unit is what the list decides.
//
// WHAT EVERY WRONG MODEL READS. A build that ran the cycle from wave 1 reads Mote,
// Sprint, Swarm, Drift, Hulk for the first five where the list says Mote, Mote,
// Sprint, Swarm, Mote; one that fielded Motes throughout reads Mote on all eight;
// one that indexed the list from `w` rather than `w - 1` reads the list shifted by
// one and fails on six of the eight.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseWaveReady, typeOfWave, watchRelease, wavesIn } from "./release";

/** The waves the opening list governs (specs/waves.md). */
const OPENING_WAVES = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * How long one wave's first arrival is waited for: three seconds of game time.
 *
 * Geometry rather than a tolerance. specs/waves.md releases the first unit "on the
 * frame the wave begins", so a correct build has already released it by the time
 * the send's own frame closes; three seconds carries a build that releases its
 * first unit a whole cadence interval late, and several intervals late at that.
 */
const FIRST_ARRIVAL_SECONDS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fields Mote, Mote, Sprint, Swarm, Mote, Drift, Mote, Hulk on waves 1 to 8", async () => {
  const waves = wavesIn();
  const fielded: { wave: number; type: string }[] = [];

  for (const wave of OPENING_WAVES) {
    poseWaveReady(h, wave);
    const released = await watchRelease(h, {
      stopAfter: 1,
      seconds: FIRST_ARRIVAL_SECONDS,
    });
    assertGreaterThanOrEqual(
      released.length,
      1,
      `precondition: wave ${wave} released a unit once it was sent`,
    );
    fielded.push({ wave, type: released[0].type });
  }

  captureStill(h, "opening");

  for (const { wave, type } of fielded) {
    assertEqual(
      type,
      typeOfWave(wave, waves),
      `the type wave ${wave} of a ${waves}-wave run fielded`,
    );
  }
});
