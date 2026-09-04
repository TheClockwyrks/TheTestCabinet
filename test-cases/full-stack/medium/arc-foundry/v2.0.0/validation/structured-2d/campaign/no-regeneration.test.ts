// campaign/no-regeneration — nothing in the game returns Grid Integrity.
//
// specs/economy.md: "Grid Integrity never regenerates." A leak is the only thing
// that moves it, and it moves it one way.
//
// So the counter is dropped well below where the run opened, and then every
// event a build might plausibly have hung a refill on is driven, with the
// counter read after each: a wave cleared without a single leak, a build phase
// sat through, the press refined, and two components folded. None of the four
// may move it.
//
// Each is a real event through the game's own systems. The wave is one the game
// composed and it is emptied through `clearUnits`, which kills nothing and leaks
// nothing (specs/instrumentation.md), so it is a clear with no leak in it. The
// refinement is bought through the panel's own control for the `20` Charge
// specs/scrap-press.md prices `R1` at. The combine is a quality fold of two
// matching Scrap components, which specs/scrap-press.md makes available in every
// phase and prices at nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  openYard,
  refinementCost,
  standComponent,
  type Harness,
} from "../harness";
import { clearWave, createRunHarness, harvestWave, RUN_HZ } from "./runs";

/** Where the counter is dropped to, well below the `20` a run opens with. */
const INTEGRITY = 7;

/** Enough to buy the first refinement several times over. */
const CHARGE = 300;

/** A minute of simulation sat through in a build phase. */
const IDLE = 60 * RUN_HZ;

/** The wave launched and cleared, and the two anchors the fold stands on. */
const WAVE = 6;
const PAIR = [
  { col: 20, row: 20 },
  { col: 24, row: 20 },
];

let h: Harness;

beforeEach(async () => {
  h = await createRunHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds Grid Integrity where a leak left it across a clear, a wait, a refinement and a fold", async () => {
  openYard(h, {
    wave: WAVE - 1,
    integrity: INTEGRITY,
    charge: CHARGE,
  });

  const readings = await captureReplay(h, "steady", async () => {
    harvestWave(h, WAVE);
    const cleared = await clearWave(h);
    assertEqual(
      cleared.snapshot.phase,
      "build",
      "the wave cleared into a build phase",
    );
    const afterClear = cleared.snapshot.integrity;

    await h.advance(IDLE);
    const afterWait = h.snapshot().integrity;

    h.debug.upgradeQuality();
    const refined = h.snapshot();
    assertEqual(
      refined.refinement,
      1,
      `the press refined to R1 for its ${refinementCost(1)} Charge`,
    );
    const afterRefine = refined.integrity;

    const first = standComponent(h, "capacitor", 1, PAIR[0]!.col, PAIR[0]!.row);
    const second = standComponent(
      h,
      "capacitor",
      1,
      PAIR[1]!.col,
      PAIR[1]!.row,
    );
    h.debug.select(first);
    h.debug.addToCombineSet(second);
    h.debug.combine(first);
    const folded = h.snapshot();
    assertEqual(
      folded.structures.find((s) => s.id === first)?.quality ??
        folded.structures.find(
          (s) => s.col === PAIR[0]!.col && s.row === PAIR[0]!.row,
        )?.quality,
      2,
      "two Scrap Capacitors folded into one Tuned",
    );

    return {
      afterClear,
      afterWait,
      afterRefine,
      afterFold: folded.integrity,
    };
  });

  assertEqual(
    readings.afterClear,
    INTEGRITY,
    "a wave cleared with no leak in it returns nothing",
  );
  assertEqual(
    readings.afterWait,
    INTEGRITY,
    "a minute of a build phase returns nothing",
  );
  assertEqual(
    readings.afterRefine,
    INTEGRITY,
    "refining the press returns nothing",
  );
  assertEqual(readings.afterFold, INTEGRITY, "a combine returns nothing");
});
