// screens/pause-restart — confirming RESTART replays the run from its opening.
//
// THE RULE. specs/screens.md's `paused` table: the `RESTART` row leads to "A fresh
// run of the same mode and difficulty, from its `opening` phase." specs/modes.md
// fixes what a run that has just started holds: it "is in the `opening` phase on
// Wave 1, with its money at that row's starting money and its lives at that row's
// starting lives."
//
// THE SAME MODE AND DIFFICULTY, WHICH IS THE HALF THAT NEEDS A DISTINGUISHING
// POSE. A run restarted at the wrong difficulty is a different run, and on
// Containment the difficulty is the only thing that decides the starting money and
// the wave count. So the run is posed on `hard` — `200` money over `26` waves,
// which is neither of the other two rows' pairs and neither of the figures the
// suite's default `medium` run would produce. A build that restarts to a default
// run reads `250` and `20`; one that keeps the run's own row reads `200` and `26`.
//
// EVERY FIGURE IS POSED AWAY FROM WHERE A FRESH RUN LEAVES IT, so no reading can
// pass by accident: the run is mid-wave, nine waves in, with money and a score it
// did not start with, fewer lives than it started with, towers standing and a unit
// on the floor. A build that answers RESTART by doing nothing at all reads every
// one of those back.
//
// THE FLOOR MUST BE EMPTY, and that is read too. specs/screens.md calls what
// RESTART opens "a fresh run", and specs/building.md pays for every tower on the
// floor out of the run's money — so a run that opens with the previous run's maze
// standing AND its full starting money back has not started fresh, it has been
// given the maze. Nothing else on this screen would catch that.
//
// WHAT PLAY AGAIN DOES from an end screen is `modes.replay-keeps-the-mode`'s
// requirement, not this one's; this is the pause menu's row.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, PAUSE_ITEMS } from "../constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  poseWalker,
  startLivesOf,
  startMoneyOf,
  waveCountOf,
  type Harness,
} from "../harness";
import { poseMenu } from "./menu";

/** The key specs/controls.md binds `confirm` to. */
const CONFIRM = BINDINGS.confirm[0];

/** The row `RESTART` sits on, second of the three `PAUSE_ITEMS`. */
const RESTART_ROW = 1;

/** The pair the run is posed on: the one whose figures no default run produces. */
const MODE = "containment";
const DIFFICULTY = "hard";

/** Where the run stood when it was paused: nothing a fresh run would report. */
const POSED = { wave: 9, money: 999, score: 777, lives: 3 } as const;

/** Two towers standing where the maze would be, well clear of the openings. */
const TOWERS: readonly { type: "arc" | "sink"; col: number; row: number }[] = [
  { type: "arc", col: 12, row: 14 },
  { type: "sink", col: 12, row: 16 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a fresh run of the same mode and difficulty", async () => {
  assertEqual(
    PAUSE_ITEMS[RESTART_ROW],
    "RESTART",
    "posing: the row this item is about (specs/screens.md, PAUSE_ITEMS)",
  );
  poseMenu(h, "paused", RESTART_ROW);
  h.debug.setMode(MODE);
  h.debug.setDifficulty(DIFFICULTY);
  h.debug.setPhase("wave");
  h.debug.setWave(POSED.wave);
  h.debug.setMoney(POSED.money);
  h.debug.setScore(POSED.score);
  h.debug.setLives(POSED.lives);
  for (const tower of TOWERS) poseTower(h, tower.type, tower.col, tower.row);
  poseWalker(h, "mote", "left");
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "paused",
    "posing: the screen the press is made on (specs/screens.md)",
  );

  await h.tap(CONFIRM);
  captureStill(h, "restarted");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "playing",
    `${CONFIRM} on the RESTART row: the screen a run opens on ` +
      `(specs/screens.md)`,
  );
  assertEqual(
    after.mode,
    MODE,
    "RESTART replays the same mode (specs/screens.md)",
  );
  assertEqual(
    after.difficulty,
    DIFFICULTY,
    "RESTART replays the same difficulty (specs/screens.md)",
  );
  assertEqual(
    after.phase,
    "opening",
    "the phase a fresh run opens in (specs/screens.md, specs/modes.md)",
  );
  assertEqual(
    after.wave,
    1,
    "the wave a fresh run opens on (specs/modes.md, specs/waves.md)",
  );
  assertEqual(
    after.waveCount,
    waveCountOf(MODE, DIFFICULTY),
    `the waves a run on ${MODE} at ${DIFFICULTY} fights, which is how a ` +
      `replay of the same pair is told from a replay of some other ` +
      `(specs/modes.md)`,
  );
  assertEqual(
    after.money,
    startMoneyOf(MODE, DIFFICULTY),
    `the money a fresh run on ${MODE} at ${DIFFICULTY} opens with, posed at ` +
      `${POSED.money} before the press (specs/modes.md)`,
  );
  assertEqual(
    after.lives,
    startLivesOf(MODE),
    `the lives a fresh run on ${MODE} opens with, posed at ${POSED.lives} ` +
      `before the press (specs/modes.md)`,
  );
  assertLength(
    after.towers,
    0,
    "the towers standing when the fresh run opened: a fresh run is built " +
      "from nothing (specs/screens.md, specs/building.md)",
  );
  assertLength(
    after.surge,
    0,
    "the surge on the floor when the fresh run opened: the opening phase " +
      "releases none (specs/screens.md, specs/waves.md)",
  );
});
