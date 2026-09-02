// Meltdown — modes/difficulty-changes-nothing-else: a difficulty moves the
// starting money and the wave count, and moves nothing else.
//
// THE RULE. `specs/modes.md`, Containment: "A difficulty changes the starting
// money and the wave count, and nothing else. The starting lives are `20` at all
// three, interest is paid at all three, the whole floor is buildable at all
// three, and the per-wave hp scaling is the same at all three." The
// derived-figures table says the same thing row by row: all three Containment
// rows read `20` lives, `yes` interest, `yes` build phases and "The whole floor"
// as their build zone.
//
// THE THREE FIXED FIGURES ARE READ AGAINST THE SPECIFICATION, not against each
// other. `startLives` must be `START_LIVES` (`20`) at every difficulty, not
// merely the same at every difficulty — a build that opened all three on `5`
// lives would satisfy sameness and still be wrong — and `interest` must be true
// and `buildZone` `null` for the same reason. `specs/instrumentation.md` puts
// `buildZone` at `null` where the whole floor may be built on, which is what "The
// whole floor" means in the table.
//
// THE HP SCALING IS READ AS A COMPARISON, and it has to be. `specs/waves.md` owns
// the figure — `hpScale(w) = 1 + 0.62 * (w - 1)` — and `surge` and `waves` items
// decide whether a build computes it. What THIS item decides is that the
// difficulty does not enter it, so the reading is one unit of one type entered at
// one wave under each of the three difficulties, and the three `maxHp` values
// compared. A build whose scaling is wrong in the same way at all three fails
// those other items and passes this one, which is exactly right: this point is
// about the difficulty and nothing else.
//
// WHY WAVE 5. It is a wave every Containment run has (`15`, `20` and `26` waves
// respectively), it is no run's milestone wave (`round(n/2)` is `8`, `10` and
// `13`), and it is far enough from wave 1 that the scaling has actually moved —
// `hpScale(5)` is `3.48`, so a Mote's `40` base hp reads `139.2` rather than its
// base. A build that scaled hp off the wave COUNT rather than the wave number
// would read three different numbers here, one per difficulty, which is the wrong
// model this comparison is aimed at.
//
// THE UNIT IS ENTERED THROUGH `addUnit`, whose `maxHp` is "its base hp scaled for
// the current wave" (`specs/instrumentation.md`), and its motion is turned off
// straight away: locomotion is no part of this requirement, and a still unit
// cannot walk into an exhaust while the reading is taken.
//
// THE TOLERANCE ON THE COMPARISON is `5e-7`, which is float representation and
// nothing else: three runs of the same scaling on the same base hp differ by
// nothing at all, and any difficulty that actually entered the figure would move
// it by whole hp.

import { afterEach, beforeEach, it } from "vitest";
import { DIFFICULTIES, START_LIVES } from "../constants";
import { assertCloseTo, assertEqual, assertNull, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  poseWalker,
  startRun,
  unitById,
  type DifficultyName,
  type Harness,
} from "../harness";

/** The wave the three units are entered on: ordinary, and no run's milestone. */
const WAVE = 5;

/** The type entered, the baseline of `specs/surge.md`. */
const TYPE = "mote";

/**
 * Decimal places the three hp readings must agree to.
 *
 * `6` is a tolerance of `5e-7`, which absorbs float representation and nothing
 * else. A difficulty that entered the scaling at all would move the figure by
 * whole hp, so there is no honest reading between the two.
 */
const HP_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** What one difficulty leaves the four figures at, on the one wave. */
function figuresAt(difficulty: DifficultyName): {
  startLives: number;
  interest: boolean;
  buildZone: unknown;
  maxHp: number | undefined;
} {
  startRun(h, "containment", difficulty);
  h.debug.setWave(WAVE);
  const id = poseWalker(h, TYPE, "left");
  h.debug.setUnitMotion(id, false);

  const snapshot = h.snapshot();
  return {
    startLives: snapshot.startLives,
    interest: snapshot.interest,
    buildZone: snapshot.buildZone,
    maxHp: unitById(snapshot, id)?.maxHp,
  };
}

it("leaves the lives, the interest, the build zone and the hp scaling alone", async () => {
  const readings = DIFFICULTIES.map((difficulty) => ({
    difficulty,
    ...figuresAt(difficulty),
  }));

  await h.advance(1);
  captureStill(h, "unchanged");

  for (const reading of readings) {
    assertEqual(
      reading.startLives,
      START_LIVES,
      `the starting lives Containment ${reading.difficulty} derives`,
    );
    assertTrue(
      reading.interest,
      `whether Containment ${reading.difficulty} pays interest`,
    );
    assertNull(
      reading.buildZone,
      `the build zone Containment ${reading.difficulty} fixes`,
    );
    assertTrue(
      reading.maxHp !== undefined,
      `precondition: a ${TYPE} entered on wave ${WAVE} at Containment ` +
        `${reading.difficulty}`,
    );
  }

  const baseline = readings[0];
  for (const reading of readings.slice(1)) {
    assertCloseTo(
      reading.maxHp as number,
      baseline.maxHp as number,
      HP_DIGITS,
      `the hp a ${TYPE} entered on wave ${WAVE} carries at Containment ` +
        `${reading.difficulty}, against Containment ${baseline.difficulty}`,
    );
  }
});
