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
// the build's own eating drives.
//
// AND ONE PELLET STANDS ON THE RUN AT A TIME. `poseStraightRun` opens on a board
// `clearPlankton` emptied, so the only food on the corridor is the pellet this
// check puts on the tile ahead of the forager. Between the two grazes the forager
// is set down at rest on the center of the tile it has just grazed, as though no
// movement key were held (specs/instrumentation.md `setForagerTile`), so the four
// seconds of decay cannot carry it into a second mouthful and re-arm the hold
// under the measurement. A tile center is also where specs/movement.md has a
// forager at rest take the direction the second graze holds: an eat lands as the
// forager's center crosses onto its tile, part way along it, and a held direction
// is honored from there only at the next center the forager reaches.
//
// THE FIXTURE'S SEALED POCKET CARRIES THE REST. Eating the plankton that leaves
// none behind clears the maze (specs/gameplay.md), which would descend and end
// the measurement on the very tick a curve is being read off, so the pellets the
// forager can never reach keep `planktonRemaining` above zero throughout.
//
// The tolerances are the review item's: `0.01` across the hold, `0.02` across the
// decay. Both are read against `g0`, the brightness on the tick the pellet went,
// so a build whose eat adds a different amount is failed by
// `brightness/from-eating` and passes or fails here on the SHAPE of its curve
// alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { BRIGHT_HALFLIFE, BRIGHT_HOLD } from "../constants";
import { poseStraightRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  seconds,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";
import { FathomSnapshot } from "../surface";
import { grazeOne } from "./graze";

/** Tiles of posed corridor: the start tile, two grazes, and room to spare. */
const RUN_TILES = 6;

/** How many pellets stand in the fixture's sealed pocket, out of the run's reach. */
const POCKET_TILES = 3;

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

it("Brightness holds, then decays", async () => {
  await startPlaying(h);
  const run = await poseStraightRun(h, RUN_TILES, { spare: true });
  // The sealed pocket sits eight tiles past the end of the run.
  const pocket = run.start.tx + RUN_TILES + 8;
  for (let step = 0; step < POCKET_TILES; step += 1) {
    h.debug.setPlankton(pocket + step, run.start.ty, true);
  }
  const watch = await sceneGuard(h, { foragerParked: false });

  const curve = await captureReplay(h, "decay", async () => {
    // One pellet, on the tile the forager is about to swim into.
    const from = h.snapshot().forager;
    h.debug.setPlankton(from.tx + 1, from.ty, true);
    const eaten = await grazeOne(h, h.snapshot(), { budget: REACH_TICKS });
    const g0 = eaten.brightness;
    // At rest for the whole of the curve below, on the center of the tile the
    // pellet went from — the tile the forager's center is on at the eat — with
    // its facing untouched, so the second graze opens from a tile center with
    // the tile ahead open to it (specs/movement.md).
    h.debug.setForagerTile(eaten.forager.tx, eaten.forager.ty);

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
    for (const t of HOLD_SAMPLES) held.push({ t, g: (await at(t)).brightness });

    const decayed: { halvings: number; g: number }[] = [];
    for (let k = 1; k <= HALVINGS; k += 1) {
      const t = BRIGHT_HOLD + k * BRIGHT_HALFLIFE;
      decayed.push({ halvings: k, g: (await at(t)).brightness });
    }

    // A further pellet, eaten mid-decay: the hold is armed in full again, so
    // `G` is steady from that tick for another whole second.
    const mid = h.snapshot();
    h.debug.setPlankton(mid.forager.tx + 1, mid.forager.ty, true);
    const again = await grazeOne(h, h.snapshot(), { budget: REACH_TICKS });
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

  requireSceneHeld(curve.end, watch);

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
