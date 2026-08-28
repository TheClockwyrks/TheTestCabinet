// brightness/holds-decays — brightness holds, then decays.
//
// specs/sensing.md gives brightness three rules, and this check reads all three
// off one real graze. Eating "arms a hold of `BRIGHT_HOLD` (1.0 s), in full each
// time", and "while the hold runs `G` is steady". Once it expires "`G` decays
// continuously, halving every `BRIGHT_HALFLIFE` (0.9 s)". And the hold is armed
// in full EACH time, so a second pellet eaten while the first is decaying starts
// a fresh second of steadiness.
//
// Nothing here poses a brightness. The eat is the forager swimming into the
// pellet on the next tile of a posed corridor, so what is measured is the curve
// the build's own eating drives. The corridor is posed with a sealed larder
// (`fixtures.ts`), which is what keeps a grazing forager from clearing the maze
// and descending in the middle of a four-second measurement.
//
// The tolerances are the review item's: `0.01` across the hold, `0.02` across the
// decay. Both are read against `g0`, the brightness on the tick the pellet went,
// so a build whose eat adds a different amount is failed by
// `brightness/from-eating` and passes or fails here on the SHAPE of its curve
// alone.

import { afterEach, beforeEach, it } from "vitest";
import { BRIGHT_HALFLIFE, BRIGHT_HOLD } from "../../src/constants";
import { assertEqual, assertLessThanOrEqual, assertNull } from "../assert";
import { poseStraightRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  seconds,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";
import {
  clearUnderfoot,
  denAll,
  graded,
  sceneGuard,
  sceneHeld,
} from "../scene";
import type { FathomSnapshot } from "../surface";
import { grazeOne } from "./graze";

/** Tiles of posed corridor: the start pellet, two eaten, and room to spare. */
const RUN_TILES = 6;

/** Frames a swim toward the next pellet is given: one tile takes 30 of them. */
const REACH_TICKS = 90;

/**
 * Where inside the hold `G` is read, in seconds from the eat.
 *
 * The last sample sits just inside `BRIGHT_HOLD`, because the eat is detected at
 * the END of the tick it happened on: the hold really began up to one tick
 * earlier, and a sample at exactly `BRIGHT_HOLD` could land a tick past its
 * expiry on a build that is keeping the rule perfectly.
 */
const HOLD_SAMPLES: readonly number[] = [0.2, 0.5, 0.8, 0.95];

/** The review item's tolerance on a steady `G` across the hold. */
const HOLD_TOLERANCE = 0.01;

/** The review item's tolerance on `G` at each halving past the hold. */
const DECAY_TOLERANCE = 0.02;

/** How many halvings past the hold are read. */
const HALVINGS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Brightness holds, then decays", async (ctx) => {
  await graded(ctx, async () => {
    await startPlaying(h);
    await poseStraightRun(h, RUN_TILES);
    const quiet = await denAll(h);
    // The pellet the pose left under the forager is eaten off camera and `G` put
    // back to zero, so the eat this check measures has its full headroom: `G`
    // clamps at 1, and an eat that raised it by almost nothing would say nothing
    // about the hold or the decay.
    await clearUnderfoot(h);
    const watch = await sceneGuard(h, quiet, { foragerParked: false });

    const curve = await captureReplay(h, "decay", async () => {
      const eaten = await grazeOne(h, h.snapshot(), { budget: REACH_TICKS });
      const g0 = eaten.brightness;

      // Across the hold, then across two halvings past it. Every wait is measured
      // from the tick the pellet went, so a slow build is failed rather than
      // waited for.
      let elapsed = 0;
      const at = async (t: number): Promise<FathomSnapshot> => {
        const target = ticks(t);
        await h.advance(target - elapsed);
        elapsed = target;
        return h.snapshot();
      };

      const held: { t: number; g: number }[] = [];
      for (const t of HOLD_SAMPLES)
        held.push({ t, g: (await at(t)).brightness });

      const decayed: { halvings: number; g: number }[] = [];
      for (let k = 1; k <= HALVINGS; k += 1) {
        const t = BRIGHT_HOLD + k * BRIGHT_HALFLIFE;
        decayed.push({ halvings: k, g: (await at(t)).brightness });
      }

      // A further pellet, eaten mid-decay: the hold is armed in full again, so
      // `G` is steady from that tick for another whole second.
      const mid = h.snapshot();
      const again = await grazeOne(h, mid, { budget: REACH_TICKS });
      const g1 = again.brightness;
      let sinceRearm = 0;
      const rearmed: { t: number; g: number }[] = [];
      for (const t of HOLD_SAMPLES) {
        const target = ticks(t);
        await h.advance(target - sinceRearm);
        sinceRearm = target;
        rearmed.push({ t, g: h.snapshot().brightness });
      }

      return { eaten, g0, held, decayed, g1, rearmed, end: h.snapshot() };
    });

    assertNull(sceneHeld(curve.end, watch), "the scenario held to the end");

    // The eat itself is `brightness/from-eating`'s verdict; all this one needs is
    // that there was one to measure a curve from.
    assertEqual(
      curve.g0 > 0,
      true,
      "eating a plankton raises G above the 0 the scenario started from",
    );

    for (const sample of curve.held) {
      assertLessThanOrEqual(
        Math.abs(sample.g - curve.g0),
        HOLD_TOLERANCE,
        `G at ${sample.t.toFixed(2)} s into the ${BRIGHT_HOLD} s hold, against ` +
          `the ${curve.g0} it was eaten to`,
      );
    }

    for (const sample of curve.decayed) {
      const expected = curve.g0 * 0.5 ** sample.halvings;
      assertLessThanOrEqual(
        Math.abs(sample.g - expected),
        DECAY_TOLERANCE,
        `G at ${seconds(ticks(BRIGHT_HOLD + sample.halvings * BRIGHT_HALFLIFE)).toFixed(2)} s, ` +
          `${sample.halvings} halving(s) past the hold, against ${expected.toFixed(4)}`,
      );
    }

    for (const sample of curve.rearmed) {
      assertLessThanOrEqual(
        Math.abs(sample.g - curve.g1),
        HOLD_TOLERANCE,
        `G at ${sample.t.toFixed(2)} s into the hold a second plankton eaten ` +
          `mid-decay arms, against the ${curve.g1} it was eaten to`,
      );
    }
  });
});
