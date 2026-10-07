// Meltdown — instrumentation/derived-fields-follow: the derived run figures
// follow the mode and the difficulty.
//
// `specs/instrumentation.md`: "`setMode` and `setDifficulty` change no other
// field. The derived figures of `specs/modes.md`, `waveCount`, `startMoney`,
// `startLives`, `interest`, and `buildZone`, follow them, and the run's live
// money, lives, and wave do not." `specs/modes.md` is the table those five come
// from, and it is the table this point reads them against — `MODE_TABLE` over
// `DIFFICULTY_TABLE`, out of the case's own seeded figures, never off the build.
//
// THE POINT IS "FOLLOW", AND FOLLOW HAS TWO HALVES. The five derived figures
// must change when the mode or the difficulty does, and the three live figures
// must not. A build that stored the derived figures at `reset` and never
// recomputed them fails the first half; a build whose `setMode` also reset the
// purse fails the second, and that is the half the specification is emphatic
// about.
//
// WITH NO OTHER OPERATION is the rest of it. Nothing below is reset, no frame is
// advanced, and no screen is touched between one row and the next: each pair of
// poses is followed immediately by the reading. A build that needed a `reset` to
// bring its figures level reads the previous row's numbers here.
//
// THE THREE CONTAINMENT ROWS ARE READ SEPARATELY FROM THE FOUR FIXED MODES,
// because they are two different rules: Containment's money and wave count come
// from the difficulty, and every other mode fixes both in its own row so the
// difficulty must change nothing at all. Posing `hard` under The Hundred and
// reading `600` and `1` back is what tells those two rules apart.
//
// AND `waveRemaining` IS THE SIXTH, ON ITS OWN RULE: "`wavePending` plus the
// number of live units while the phase is `wave`, and `wavePending` alone
// otherwise." Both halves are read, on one floor, by moving the phase.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  DIFFICULTY_TABLE,
  MODE_TABLE,
  START_LIVES,
  type DifficultyName,
  type ModeName,
} from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  tileCenter,
  type Harness,
  type ZoneSnapshot,
} from "../harness";
import { quietSite } from "./ground";

/** What `specs/modes.md` gives a mode and difficulty, out of the case's tables. */
function figuresFor(
  mode: ModeName,
  difficulty: DifficultyName,
): {
  waveCount: number;
  startMoney: number;
  startLives: number;
  interest: boolean;
  buildZone: ZoneSnapshot | null;
} {
  const row = MODE_TABLE[mode];
  const step = DIFFICULTY_TABLE[difficulty];
  return {
    waveCount: row.waveCount ?? step.waves,
    startMoney: row.startMoney ?? step.money,
    startLives: row.startLives,
    interest: row.interest,
    buildZone:
      row.buildZone === null
        ? null
        : {
            col0: row.buildZone.col0,
            row0: row.buildZone.row0,
            col1: row.buildZone.col1,
            row1: row.buildZone.row1,
          },
  };
}

/**
 * The rows read, in the order they are posed.
 *
 * All three Containment difficulties, because a difficulty is what decides that
 * mode's money and wave count; then each of the four other modes at a difficulty
 * that is NOT the one before it, so a mode whose row fixes both figures is caught
 * letting the difficulty through.
 */
const ROWS: readonly [ModeName, DifficultyName][] = [
  ["containment", "easy"],
  ["containment", "medium"],
  ["containment", "hard"],
  ["hundred", "hard"],
  ["deeppockets", "easy"],
  ["bottleneck", "medium"],
  ["suddendeath", "hard"],
];

/** The live figures posed before the sweep, none of which may move. */
const LIVE_MONEY = 4321;
const LIVE_LIVES = 17;
const LIVE_WAVE = 13;

/** The units posed on the floor for the `waveRemaining` reading. */
const LIVE_UNITS = 3;

/** What is left to release when `waveRemaining` is read. */
const PENDING = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("recomputes waveCount, startMoney, startLives, interest and buildZone from the mode and difficulty alone", async () => {
  startRun(h);

  // The run's own figures, posed to values no row of the table carries, so a
  // build that overwrote one from the table is caught by the value it wrote.
  h.debug.setMoney(LIVE_MONEY);
  h.debug.setLives(LIVE_LIVES);
  h.debug.setWave(LIVE_WAVE);

  for (const [mode, difficulty] of ROWS) {
    h.debug.setMode(mode);
    h.debug.setDifficulty(difficulty);

    const snapshot = h.snapshot();
    const want = figuresFor(mode, difficulty);
    const where = `${mode} / ${difficulty}`;

    assertEqual(snapshot.waveCount, want.waveCount, `${where}: waveCount`);
    assertEqual(snapshot.startMoney, want.startMoney, `${where}: startMoney`);
    assertEqual(snapshot.startLives, want.startLives, `${where}: startLives`);
    assertEqual(snapshot.interest, want.interest, `${where}: interest`);
    assertDeepEqual(snapshot.buildZone, want.buildZone, `${where}: buildZone`);

    // And the live run, which follows neither.
    assertEqual(snapshot.money, LIVE_MONEY, `${where}: the live money`);
    assertEqual(snapshot.lives, LIVE_LIVES, `${where}: the live lives`);
    assertEqual(snapshot.wave, LIVE_WAVE, `${where}: the live wave`);
  }

  // The one figure that follows neither table: `waveRemaining`.
  h.debug.setMode("containment");
  h.debug.setDifficulty("medium");
  h.debug.setWavePending(PENDING);
  for (let i = 0; i < LIVE_UNITS; i += 1) {
    h.debug.addUnit("mote", "left");
    const surge = h.snapshot().surge;
    const unit = surge[surge.length - 1];
    const site = quietSite(i + 8);
    const at = tileCenter(site.col, site.row);
    h.debug.setUnitPosition(unit.id, at.x, at.y);
    h.debug.setUnitMotion(unit.id, false);
  }

  h.debug.setPhase("wave");
  assertEqual(
    h.snapshot().waveRemaining,
    PENDING + LIVE_UNITS,
    "waveRemaining in the wave phase: wavePending plus the live units",
  );

  h.debug.setPhase("building");
  assertEqual(
    h.snapshot().waveRemaining,
    PENDING,
    "waveRemaining outside the wave phase: wavePending alone",
  );

  // Sudden Death is the one row whose lives differ, so the sweep really did read
  // a table rather than one constant.
  h.debug.setMode("suddendeath");
  assertEqual(
    h.snapshot().startLives,
    MODE_TABLE.suddendeath.startLives,
    "Sudden Death's starting lives",
  );
  h.debug.setMode("containment");
  assertEqual(
    h.snapshot().startLives,
    START_LIVES,
    "Containment's starting lives",
  );

  await h.advance(1);
  captureStill(h, "derived");
});
