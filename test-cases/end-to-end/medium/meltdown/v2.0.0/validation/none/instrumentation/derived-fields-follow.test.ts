// Meltdown — instrumentation/derived-fields-follow: the run figures the snapshot
// marks DERIVED follow the mode and the difficulty, and nothing else.
//
// THE RULE. `specs/instrumentation.md` says of `setMode` and `setDifficulty`
// that they "change no other field", and that "the derived figures of
// `specs/modes.md`, `waveCount`, `startMoney`, `startLives`, `interest`, and
// `buildZone`, follow them". It says of `waveRemaining` that it is "`wavePending`
// plus the number of live units while the phase is `wave`, and `wavePending`
// alone otherwise".
//
// WHY IT IS A POINT OF ITS OWN. Six suites pose a run by choosing a mode and a
// difficulty and then reading a figure the pair fixes. If a build carries those
// figures as ordinary fields that some START path writes, choosing the pair
// through the surface leaves them at whatever the last start left, and every one
// of those suites measures the wrong row while looking exactly like it worked.
// So the two operations are called with NOTHING ELSE between `reset` and the
// read: no start, no screen change, no money, no wave.
//
// EVERY ROW IS DISTINGUISHING. The six pairs below differ from one another in
// every one of the five figures at least once — the money over `200`, `250`,
// `300`, `350`, `600` and `10000`, the wave count over `1`, `15`, `20` and `26`,
// the lives over `20` and `1`, `interest` both ways, and `buildZone` both null
// and a rectangle — so a build that reports one row's figures for another, or a
// constant, reads as the wrong number rather than as coincidentally right.
//
// WHAT THIS DOES NOT DECIDE. Whether each row's figures are the ones
// `specs/modes.md` states is the `modes/*` group's, one item per row. This point
// asserts that whatever the specification's table gives the pair is what the
// snapshot reports after those two operations and no others.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { modeFigures, type DifficultyId, type ModeId } from "../constants";
import {
  captureStill,
  createHarness,
  poseWalker,
  startRun,
  type Harness,
} from "../harness";

/**
 * The pairs read, chosen so that each of the five derived figures takes at least
 * two different values across the set (`specs/modes.md`).
 */
const ROWS: readonly { mode: ModeId; difficulty: DifficultyId }[] = [
  { mode: "containment", difficulty: "easy" },
  { mode: "containment", difficulty: "medium" },
  { mode: "containment", difficulty: "hard" },
  { mode: "hundred", difficulty: "medium" },
  { mode: "deeppockets", difficulty: "medium" },
  { mode: "bottleneck", difficulty: "medium" },
  { mode: "suddendeath", difficulty: "medium" },
];

/** The units still to release, and the units posed onto the floor beside them. */
const PENDING = 9;
const WALKERS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("derives the five run figures from the mode and the difficulty alone", async () => {
  for (const row of ROWS) {
    const what = `${row.mode}/${row.difficulty}`;
    // Back to the title first, so each row is read from the same start and no
    // row can be carried by the one before it. Then the two operations under
    // test, and NOTHING else.
    await h.debug.reset();
    await h.debug.setMode(row.mode);
    await h.debug.setDifficulty(row.difficulty);

    const s = await h.snapshot();
    const figures = modeFigures(row.mode, row.difficulty);
    assertEqual(s.mode, row.mode, `${what}: the mode that was set`);
    assertEqual(
      s.difficulty,
      row.difficulty,
      `${what}: the difficulty that was set`,
    );
    assertEqual(s.startMoney, figures.startMoney, `${what}: startMoney`);
    assertEqual(s.waveCount, figures.waveCount, `${what}: waveCount`);
    assertEqual(s.startLives, figures.startLives, `${what}: startLives`);
    assertEqual(s.interest, figures.interest, `${what}: interest`);
    assertDeepEqual(s.buildZone, figures.buildZone, `${what}: buildZone`);
  }

  // The last row read, on the screen `reset` leaves the game on.
  await h.advance(1);
  await captureStill(h, "derived");
});

it("counts waveRemaining as the pending units plus the wave's live ones", async () => {
  await startRun(h);
  await h.debug.setWavePending(PENDING);

  // A build phase: the pending units alone, whatever stands on the floor.
  const building = await h.snapshot();
  assertEqual(
    building.waveRemaining,
    PENDING,
    "waveRemaining in a build phase, with nothing released",
  );

  for (let i = 0; i < WALKERS; i += 1) {
    await poseWalker(h, "mote", i % 2 === 0 ? "left" : "top");
  }
  const withUnits = await h.snapshot();
  assertLength(withUnits.surge, WALKERS, "the posed surge roster");
  assertEqual(
    withUnits.waveRemaining,
    PENDING,
    "waveRemaining in a build phase, with units on the floor",
  );

  // The wave phase: the pending units and the live ones together.
  await h.debug.setPhase("wave");
  assertEqual(
    (await h.snapshot()).waveRemaining,
    PENDING + WALKERS,
    "waveRemaining in the wave phase",
  );

  // And it follows each of the two terms on its own. One unit off the floor:
  const roster = (await h.snapshot()).surge;
  await h.debug.removeUnit(roster[0].id);
  assertEqual(
    (await h.snapshot()).waveRemaining,
    PENDING + WALKERS - 1,
    "waveRemaining after one live unit went",
  );
  // and the pending count down to nothing:
  await h.debug.setWavePending(0);
  assertEqual(
    (await h.snapshot()).waveRemaining,
    WALKERS - 1,
    "waveRemaining with nothing left to release",
  );
});
