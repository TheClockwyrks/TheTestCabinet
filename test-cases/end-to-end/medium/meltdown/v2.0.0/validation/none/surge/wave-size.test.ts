// Meltdown — surge/wave-size: a wave counts out, and releases, the number the
// closed form gives it.
//
// THE RULE. `specs/waves.md`:
//
//   waveSize(w, n) = 1                                          if the wave is a Core wave
//                    ceil(WAVE_BASE_COUNT[type] * (1 + 0.22 * (w - 1)))  otherwise
//
// with `WAVE_GROWTH` `0.22` and a base count per type — `12` for the Mote, `8`
// for the Drift — so "Wave 1 releases 12 Motes and a milestone wave releases
// exactly one Core."
//
// THREE WAVES, CHOSEN FOR WHAT EACH SEPARATES.
//
//   WAVE 1 is the base count with no growth at all: `12` Motes. It is what pins
//   the base of the curve, and the only reading of the three a build that ignored
//   `WAVE_GROWTH` entirely would get right.
//   WAVE 6 is a Drift wave, whose base is `8` and whose growth factor is `2.1`:
//   `ceil(16.8)` is `17`. The fraction is what makes it a reading of the CEILING
//   as well — `floor` gives `16` and rounding to nearest gives `17`, so a build
//   that truncated is one unit short. And the type is not the Mote, so a build
//   that used one base count for every type reads `26` here against `17`.
//   WAVE 10 is the mid-run milestone of a twenty-wave run, which the first branch
//   of the form fixes at exactly `1` however large the growth has become. A build
//   that ran the Core through the ordinary arithmetic would field `ceil(1 * 2.98)`
//   — three bosses at once — and a build that gave the Core the Mote's base would
//   field thirty-six.
//
// TWO READINGS PER WAVE, BECAUSE COUNTING AND RELEASING ARE DIFFERENT FAILURES.
//
//   WHAT THE WAVE COUNTED OUT. On the frame the first unit is released the rest
//   are still pending, so the units on the floor plus `wavePending` is the whole
//   wave (`specs/waves.md`, `specs/instrumentation.md`). The floor is empty before
//   the send, so that sum is exactly what the wave was built with.
//   WHAT ACTUALLY ARRIVED. The whole release is then watched and every distinct
//   unit id that appears is counted. A build that counted seventeen onto the wave
//   and released twelve passes the first reading and fails this one; a build that
//   counted twelve and kept releasing past them fails it in the other direction.
//   Ids are distinct among live entities and are never reused while the entity
//   holding one is live, so counting distinct ids counts units — including the
//   ones that have already leaked by the end of the window.
//
// THE WINDOW IS THE CADENCE PLUS TWO SECONDS (`surge/roster.ts`), so a release
// running to the stated `WAVE_SPAWN_INTERVAL` finishes inside it with more than
// three intervals to spare, and a build that kept going is caught by the margin.
// The lives are posed past every leak, so the run cannot end half way through the
// count it is being read on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { waveSize, waveType } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { firstRelease, openWave, releaseSeconds, watchRelease } from "./roster";

/** The run the sizes are read in: twenty waves, so wave 10 is a milestone. */
const WAVE_COUNT = 20;

/** The three waves read: the base, a fractional growth, and a milestone. */
const WAVES: readonly number[] = [1, 6, 10];

/** Which of them the picture is taken on: the fullest floor of the three. */
const PICTURE_WAVE = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("counts out and releases 12 on wave 1, 17 on wave 6 and 1 on the milestone", async () => {
  const read: {
    wave: number;
    counted: number;
    arrived: number;
    pending: number;
  }[] = [];

  for (const wave of WAVES) {
    await openWave(h, wave);
    const opened = await firstRelease(h);
    const counted = opened.snapshot.surge.length + opened.snapshot.wavePending;
    const arrivals = await watchRelease(
      h,
      releaseSeconds(waveSize(wave, WAVE_COUNT)),
    );
    if (wave === PICTURE_WAVE) await captureStill(h, "size");
    read.push({
      wave,
      counted,
      arrived: arrivals.length,
      pending: (await h.snapshot()).wavePending,
    });
  }

  for (const { wave, counted, arrived, pending } of read) {
    const want = waveSize(wave, WAVE_COUNT);
    const type = waveType(wave, WAVE_COUNT);
    assertEqual(
      counted,
      want,
      `the units wave ${wave} of a ${WAVE_COUNT}-wave run counted onto ` +
        `itself: a ${type} wave releases ${want} (specs/waves.md)`,
    );
    assertEqual(
      pending,
      0,
      `units wave ${wave} still had left to release once its whole cadence ` +
        `had run: a wave releases every unit it counted out (specs/waves.md)`,
    );
    assertEqual(
      arrived,
      want,
      `the distinct units wave ${wave} actually released over its whole ` +
        `cadence: a ${type} wave releases ${want} (specs/waves.md)`,
    );
  }
});
