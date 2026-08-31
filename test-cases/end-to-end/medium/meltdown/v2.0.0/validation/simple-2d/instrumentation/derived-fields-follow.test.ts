// Meltdown — instrumentation/derived-fields-follow: the derived run figures follow
// the mode and difficulty.
//
// specs/instrumentation.md, The screen and the run: "`setMode` and `setDifficulty`
// change no other field. The derived figures of `specs/modes.md`, `waveCount`,
// `startMoney`, `startLives`, `interest`, and `buildZone`, follow them, and the
// run's live money, lives, and wave do not." specs/modes.md is where those five
// figures are tabulated, and specs/instrumentation.md's own note repeats that they
// are "derived from `mode` and `difficulty` by the table in `specs/modes.md`" —
// which is why the surface carries no setter for any of them.
//
// THE POINT IS THE FOLLOWING, NOT THE FIGURES. What each figure IS for each pair
// is decided by `modes`, one item per row of that table; what this item decides is
// that the five of them move when the pair moves, with NO OTHER OPERATION run in
// between, and that the three live run figures stay exactly where they were put.
// Both directions are read on every pair, because a build that derives one figure
// and stores another is caught only where the stored one fails to move.
//
// THE LIVE FIGURES ARE POSED AWAY FROM EVERY DERIVED VALUE ON THE TABLE. `4321`
// money, `46` lives and Wave `3` are no mode's starting money, no mode's starting
// lives and no mode's wave count, so a build that re-derives the live run out of
// the new pair — the exact defect the specification's "and the run's live money,
// lives, and wave do not" forbids — reads a figure off the table instead of the
// one it was handed.
//
// AND `waveRemaining` IS READ ON BOTH SIDES OF ITS OWN RULE. specs/instrumentation.md:
// it "is `wavePending` plus the number of live units while the phase is `wave`,
// and `wavePending` alone otherwise". So a `wave` phase carrying units reads the
// sum, and the same floor in a `building` phase reads the pending alone — the pair
// that tells a build deriving the sum from the phase apart from one that always
// adds the roster, and from one that never does.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { MODE_TABLE } from "../../src/constants";
import {
  captureStill,
  createHarness,
  poseWalker,
  startLivesOf,
  startMoneyOf,
  startRun,
  waveCountOf,
  type DifficultyName,
  type Harness,
  type ModeName,
} from "../harness";

/** Every pair the table has a row for: the three Containment rows, then the four
 * modes that fix both figures in their own row (specs/modes.md). */
const PAIRS: ReadonlyArray<[ModeName, DifficultyName]> = [
  ["containment", "easy"],
  ["containment", "medium"],
  ["containment", "hard"],
  ["hundred", "medium"],
  ["deeppockets", "medium"],
  ["bottleneck", "medium"],
  ["suddendeath", "medium"],
];

/** The live run figures, posed off every value the derived table carries. */
const LIVE = { money: 4321, lives: 46, wave: 3 } as const;

/** The pending count and the units posed beside it, for `waveRemaining`. */
const PENDING = 5;
const LIVE_UNITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("derives waveCount, startMoney, startLives, interest and buildZone from the pair", async () => {
  startRun(h);

  for (const [mode, difficulty] of PAIRS) {
    const at = `${mode} / ${difficulty}`;

    // The live run, posed away from every figure on the table, and then the pair
    // — and nothing else between the pose and the reading.
    h.debug.setMoney(LIVE.money);
    h.debug.setLives(LIVE.lives);
    h.debug.setWave(LIVE.wave);
    h.debug.setMode(mode);
    h.debug.setDifficulty(difficulty);

    const s = h.snapshot();
    assertEqual(s.mode, mode, `${at}: mode`);
    assertEqual(s.difficulty, difficulty, `${at}: difficulty`);

    // The five derived figures follow.
    assertEqual(
      s.waveCount,
      waveCountOf(mode, difficulty),
      `${at}: waveCount follows the pair`,
    );
    assertEqual(
      s.startMoney,
      startMoneyOf(mode, difficulty),
      `${at}: startMoney follows the pair`,
    );
    assertEqual(
      s.startLives,
      startLivesOf(mode),
      `${at}: startLives follows the mode`,
    );
    assertEqual(
      s.interest,
      MODE_TABLE[mode].interest,
      `${at}: interest follows the mode`,
    );
    assertDeepEqual(
      s.buildZone,
      MODE_TABLE[mode].buildZone,
      `${at}: buildZone follows the mode`,
    );

    // And the live run does not.
    assertEqual(s.money, LIVE.money, `${at}: the live money is untouched`);
    assertEqual(s.lives, LIVE.lives, `${at}: the live lives are untouched`);
    assertEqual(s.wave, LIVE.wave, `${at}: the live wave is untouched`);
  }

  await h.advance(1);
  captureStill(h, "derived");
});

it("derives waveRemaining from wavePending and the live wave units", async () => {
  startRun(h);
  h.debug.setPhase("wave");
  h.debug.setWavePending(PENDING);

  assertEqual(
    h.snapshot().waveRemaining,
    PENDING,
    "a wave phase with nothing on the floor: the pending alone",
  );

  for (let i = 0; i < LIVE_UNITS; i += 1) poseWalker(h, "mote", "left");
  assertEqual(
    h.snapshot().waveRemaining,
    PENDING + LIVE_UNITS,
    "a wave phase carrying units: the pending plus the live units",
  );

  // The same floor, off the wave phase: the pending alone again.
  h.debug.setPhase("building");
  assertEqual(
    h.snapshot().waveRemaining,
    PENDING,
    "a build phase carrying units: the pending alone",
  );

  await h.advance(1);
});
