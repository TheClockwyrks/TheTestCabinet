// sonar/wavefront — the pulse is a front travelling the corridors, and it ends
// where its range does.
//
// specs/sensing.md: "A wavefront, not an instant circle. The front advances at
// `SONAR_WAVE_SPEED` (`14`) corridor steps per second, so it stands `14 * t`
// steps out `t` seconds after the pulse, and the pulse ends once the front
// passes `E`."
//
// TWO CLAIMS. The RATE — where the front stands at a given moment — and the END,
// that a pulse leaves `pulses` once the front is past its range rather than
// hanging about or, at the other extreme, covering the whole flood the instant it
// is cast. A build that reports `front` jumping straight to its range fails the
// first sample; one that never advances it fails the later ones; one that keeps a
// spent pulse on the list fails the last reading.
//
// THE CORRIDOR IS LONGER THAN THE RANGE. The run is `RUN_TILES` tiles, so there
// are more corridor steps out from the forager than the `9` `E` is at depth `1`
// and the front travels through real corridor for the whole of its life. On a
// board where the corridor ran out first, "how far has the front gone" would be a
// question about the fixture.
//
// WHAT THIS DOES NOT DECIDE. Which tiles the front reveals and in what order,
// which is `sonar/near-before-far`'s and `sonar/reveals-walls`'; and what `range`
// is at a given depth, which is `progression/depth-scaling`'s. This reads the
// pulse's own reported `range` and asks only that the pulse ends past it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNull,
} from "../assert";
import { SONAR_WAVE_SPEED, TICK_DT, TICK_HZ } from "../../src/constants";
import { poseStraightRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  seconds,
  startPlaying,
  type Harness,
} from "../harness";
import {
  clearUnderfoot,
  denAll,
  graded,
  parkForager,
  sceneGuard,
  sceneHeld,
} from "../scene";
import { castPulse, foragerPulse, requirePress, sinceEmit } from "./pulse";

/**
 * The corridor the pulse travels, in tiles.
 *
 * Twelve, so eleven corridor steps run out from the forager's own tile — two
 * more than the `SONAR_RANGE_BASE` (`9`) steps a depth-1 pulse carries.
 */
const RUN_TILES = 12;

/**
 * Where the front is read, in ticks after the press.
 *
 * Three samples spread across the pulse's life. The last of them, `66` ticks, is
 * `0.55 s`, where a conforming front stands `7.7` steps out — comfortably short
 * of the `9` that ends the pulse even with the tolerance below spent, so the
 * pulse is still in flight to be read.
 */
const SAMPLE_TICKS = [24, 48, 66] as const;

/**
 * How far the front may sit from `SONAR_WAVE_SPEED * t`, as a fraction.
 *
 * The item's bound: five percent.
 */
const RATE_TOLERANCE = 0.05;

/**
 * The extra slack every sample carries, in corridor steps.
 *
 * One tick's worth of travel. Elapsed time is measured from the snapshot taken
 * before the key went down, so it covers the tick the press ran on, and
 * specs/sensing.md fixes what the front does from the moment of the pulse without
 * fixing where inside that tick the casting falls. A build that casts before it
 * steps and one that casts after are a tick apart and both honour the page.
 */
const EMIT_SLACK = SONAR_WAVE_SPEED * TICK_DT;

/**
 * The most the front may have travelled at the first reading, in corridor steps.
 *
 * One step. The reading is taken one tick after the press, where a conforming
 * front stands `0.12` steps out; a build that floods every tile the instant the
 * pulse is cast reports its whole range here instead.
 */
const OPENING_MAX = 1;

/**
 * When the pulse must be gone by, in ticks after the press.
 *
 * `0.9 s`, where a conforming front stands `12.6` steps out — a third past the
 * `9` `E` is at depth `1`, and past it even with the whole rate tolerance spent
 * the slow way. A hard ceiling, so a build that leaves spent pulses on the list
 * FAILS here rather than leaving the point undecided.
 */
const SPENT_TICKS = 108;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("advances the front at SONAR_WAVE_SPEED and takes the pulse off the list once it passes its range", async (ctx) => {
  await graded(ctx, async () => {
    await startPlaying(h);
    const run = await poseStraightRun(h, RUN_TILES);
    await parkForager(h, { tx: run.tx, ty: run.ty });
    await clearUnderfoot(h);
    const quiet = await denAll(h);
    const watch = await sceneGuard(h, quiet);

    const flight = await captureReplay(h, "wave", async () => {
      const emitted = await castPulse(h);
      // A press that did nothing at all is controls/sonar-key's; a press that
      // armed the cooldown and left no front is exactly what THIS point decides,
      // so it is asserted below rather than stood down on.
      requirePress(emitted);

      const samples: {
        ticks: number;
        elapsed: number;
        front: number | null;
      }[] = [];
      let stood = 1; // the tick the press itself ran
      for (const at of SAMPLE_TICKS) {
        await h.advance(at - stood);
        stood = at;
        const snapshot = h.snapshot();
        const pulse = foragerPulse(snapshot);
        samples.push({
          ticks: at,
          elapsed: sinceEmit(emitted, snapshot),
          front: pulse === undefined ? null : pulse.front,
        });
      }

      // Out past the range, where the pulse is meant to be gone.
      await h.advance(SPENT_TICKS - stood);
      const spent = h.snapshot();

      return { emitted, samples, spent };
    });

    assertNull(sceneHeld(h.snapshot(), watch), "the scenario held to the end");

    // The pulse begins at the forager rather than arriving everywhere at once —
    // and it is still there a tick after the press to begin at all.
    assertEqual(
      flight.emitted.pulse !== null,
      true,
      "a wavefront on pulses one tick after the press, which a pulse that " +
        "travels rather than covering its whole range at once must still be",
    );
    if (flight.emitted.pulse === null) return;
    assertLessThanOrEqual(
      flight.emitted.pulse.front,
      OPENING_MAX,
      "the front one tick after the pulse was cast, in corridor steps",
    );

    // And stands 14 * t steps out at each reading.
    let previous = flight.emitted.pulse.front;
    for (const sample of flight.samples) {
      assertEqual(
        sample.front !== null,
        true,
        `a forager pulse still in flight ${sample.ticks} ticks after the press, ` +
          `where a front at SONAR_WAVE_SPEED stands ` +
          `${(SONAR_WAVE_SPEED * seconds(sample.ticks)).toFixed(2)} steps out of ` +
          `the ${flight.emitted.pulse.range} its range allows`,
      );
      if (sample.front === null) continue;
      const expected = SONAR_WAVE_SPEED * sample.elapsed;
      assertLessThanOrEqual(
        Math.abs(sample.front - expected),
        RATE_TOLERANCE * expected + EMIT_SLACK,
        `|front - ${expected.toFixed(3)}| ${sample.ticks} ticks ` +
          `(${sample.elapsed.toFixed(3)} s) after the press, in corridor steps`,
      );
      assertGreaterThan(
        sample.front,
        previous,
        `the front ${sample.ticks} ticks after the press, against where it stood ` +
          "at the reading before",
      );
      previous = sample.front;
    }

    // The pulse ends once the front passes its range.
    assertEqual(
      foragerPulse(flight.spent),
      undefined,
      `a forager pulse still listed ${SPENT_TICKS} ticks ` +
        `(${(SPENT_TICKS / TICK_HZ).toFixed(2)} s) after the press, by which time ` +
        `a front at SONAR_WAVE_SPEED stands ` +
        `${(SONAR_WAVE_SPEED * seconds(SPENT_TICKS)).toFixed(1)} steps out and is ` +
        `past the ${flight.emitted.pulse.range} its range allows`,
    );
  });
});
