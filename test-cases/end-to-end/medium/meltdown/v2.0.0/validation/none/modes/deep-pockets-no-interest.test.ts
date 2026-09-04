// modes/deep-pockets-no-interest — Deep Pockets pays no interest on entering a
// build phase.
//
// THE RULE. `specs/modes.md`'s table gives Deep Pockets `no` under Interest, and
// its own section repeats it: the mode "pays no interest on entering a build
// phase". `specs/economy.md` states what is being withheld — interest is
// "`min(floor(INTEREST_RATE * money), INTEREST_CAP)` ... paid only on entering a
// build phase between waves", and "a mode whose `interest` reads false pays none
// at all".
//
// WHY A BUILD PHASE IS ENTERED FOR REAL. Interest is an ENTRY EFFECT, and
// `setPhase` runs none (`specs/instrumentation.md`): a posed build phase would
// pay nothing under any build, conforming or not, and the check would decide
// nothing. So the phase is reached the way the run reaches it — a wave clearing.
// The end-of-wave shape, `wavePending` at `0` with one live unit
// (`specs/waves.md`), is posed with one Mote two tiles short of its exhaust, and
// the clear is left to the game.
//
// WHAT IS READ, AND WHY AS A CEILING. Two things land on the money in that one
// transition: the wave-clear bonus, which every mode pays, and the interest, which
// this one must not. Money is one number, so the honest reading is an UPPER BOUND
// — that nothing beyond the bonus arrived. `assertLessThanOrEqual` is therefore
// the right direction: a build paying too small a bonus is
// `economy.wave-clear-bonus`'s failure, not this item's, and a build paying the
// interest is caught here and only here.
//
// THE OPENING BALANCE IS CHOSEN SO THE GAP IS THE WHOLE CAP. At `START_MONEY` the
// interest that must not be paid works out to `INTEREST_CAP`, the largest it can
// ever be, which is `40` money clear of the ceiling below. A smaller balance would
// leave a narrower gap for nothing.
//
// AND THE FLAG ITSELF. `interest` is a derived snapshot field, so the mode's own
// answer is read beside what its money did.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  COLS,
  INTEREST_CAP,
  INTEREST_RATE,
  WAVE_CLEAR_BASE,
  WAVE_CLEAR_PER_WAVE,
  tileCX,
  tileCY,
} from "../constants";
import { LEFT_LANE_ROW } from "../fixtures";
import {
  captureStill,
  createHarness,
  framesFor,
  poseWalker,
  startRun,
  type Harness,
} from "../harness";

/** The wave that is cleared. Wave 1 of a twenty-wave run, so a build phase follows. */
const WAVE = 1;

/**
 * The money the run carries into the clear.
 *
 * Chosen so the interest a paying mode would add is the full `INTEREST_CAP`:
 * `floor(0.08 * 525)` is `42`, capped at `40`. That is the widest gap the rule
 * can be missed by, and it is `40` money past the ceiling asserted below.
 */
const START_MONEY = 500;

/** What the clear itself pays, which is the whole of what may arrive. */
const CLEAR_BONUS = WAVE_CLEAR_BASE + WAVE_CLEAR_PER_WAVE * WAVE;
/** The ceiling the money must stay under: the bonus and not a coin more. */
const MONEY_CEILING = START_MONEY + CLEAR_BONUS;
/** What a mode that wrongly paid interest would read, for the record. */
const IF_PAID =
  MONEY_CEILING +
  Math.min(Math.floor(INTEREST_RATE * MONEY_CEILING), INTEREST_CAP);

/**
 * Where the last unit of the wave is posed: two tiles short of the right
 * exhaust, on the left corridor's own row.
 *
 * Geometry, not a tolerance. Near enough that the clear costs a fraction of a
 * second of game time, far enough that the unit is genuinely walking when the
 * drive begins.
 */
const LEAK_TILE = { col: COLS - 3, row: LEFT_LANE_ROW };

/**
 * How long the unit is given to cover those two tiles.
 *
 * A Mote covers `60` logical units a second (`specs/surge.md`) and two tiles is
 * `38`. A ceiling on a hung build rather than a bound on anything asserted.
 */
const LEAK_WINDOW = 2.0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("pays nothing beyond the wave-clear bonus on entering a build phase", async () => {
  const { debug } = h;
  await startRun(h, "deeppockets");
  await debug.setPhase("wave");
  await debug.setBuildTimer(0);
  await debug.setWave(WAVE);
  await debug.setWavePending(0);
  await debug.setMoney(START_MONEY);
  const mote = await poseWalker(h, "mote", "left");
  await debug.setUnitPosition(
    mote,
    tileCX(LEAK_TILE.col),
    tileCY(LEAK_TILE.row),
  );

  const cleared = await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: framesFor(LEAK_WINDOW),
  });
  await captureStill(h, "balance");

  assertEqual(cleared.hit, true, "the last unit of the wave left the floor");
  // The transition this item is about really happened: without a build phase
  // opened there is nothing for interest to have been paid on, and the ceiling
  // below would hold for a build that simply never left the wave.
  assertEqual(
    cleared.snapshot.phase,
    "building",
    "the build phase the clear opened",
  );
  assertEqual(
    cleared.snapshot.interest,
    false,
    "Deep Pockets pays no interest",
  );
  assertLessThanOrEqual(
    cleared.snapshot.money,
    MONEY_CEILING,
    `the money after the clear; a mode that paid interest would read ${IF_PAID}`,
  );
});
