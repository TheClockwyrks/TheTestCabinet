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
//
// THE WAIT IS A MINUTE OF SIMULATION, NOT A COUNT OF FRAMES. The claim the wait
// tests is that nothing accrues over time, so what it has to be is long — and it
// is kept at a minute. How that minute is divided is the check's to choose:
// specs/instrumentation.md guarantees that "an interval of simulation time reaches
// the same state however it was divided into frames", and
// `instrumentation/frame-division-movement` and
// `instrumentation/frame-division-projectile` are the two points that decide that
// guarantee. Nothing here is positional and nothing here is a projectile — four
// readings of one integer counter are — so the whole check runs at `STEADY_HZ`
// and every span it covers is the span it always covered.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { refinementCost } from "../constants";
import {
  captureReplay,
  openYard,
  standComponent,
  type Harness,
} from "../harness";
import { clearWave, createRunHarness, harvestWave } from "./runs";

/** Where the counter is dropped to, well below the `20` a run opens with. */
const INTEGRITY = 7;

/** Enough to buy the first refinement several times over. */
const CHARGE = 300;

/** The frame rate the whole check runs at: see the header. */
const STEADY_HZ = 5;

/** A minute of simulation sat through in a build phase. */
const IDLE = 60 * STEADY_HZ;

/** The wave launched and cleared, and the two anchors the fold stands on. */
const WAVE = 6;
const PAIR = [
  { col: 20, row: 20 },
  { col: 24, row: 20 },
];

let h: Harness;

beforeEach(async () => {
  h = await createRunHarness(STEADY_HZ);
});

afterEach(async () => {
  await h.dispose();
});

it("holds Grid Integrity where a leak left it across a clear, a wait, a refinement and a fold", async () => {
  await openYard(h, {
    wave: WAVE - 1,
    integrity: INTEGRITY,
    charge: CHARGE,
  });

  const readings = await captureReplay(h, "steady", async () => {
    await harvestWave(h, WAVE);
    const cleared = await clearWave(h);
    assertEqual(
      cleared.snapshot.phase,
      "build",
      "the wave cleared into a build phase",
    );
    const afterClear = cleared.snapshot.integrity;

    await h.advance(IDLE);
    const afterWait = (await h.snapshot()).integrity;

    await h.debug.upgradeQuality();
    const refined = await h.snapshot();
    assertEqual(
      refined.refinement,
      1,
      `the press refined to R1 for its ${refinementCost(1)} Charge`,
    );
    const afterRefine = refined.integrity;

    const first = await standComponent(
      h,
      "capacitor",
      1,
      PAIR[0]!.col,
      PAIR[0]!.row,
    );
    const second = await standComponent(
      h,
      "capacitor",
      1,
      PAIR[1]!.col,
      PAIR[1]!.row,
    );
    await h.debug.select(first);
    await h.debug.addToCombineSet(second);
    await h.debug.combine(first);
    const folded = await h.snapshot();
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
