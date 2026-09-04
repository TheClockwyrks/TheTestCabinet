// modes/difficulty-changes-nothing-else — a difficulty changes the starting money
// and the wave count, and nothing else.
//
// THE RULE. `specs/modes.md`: "A difficulty changes the starting money and the
// wave count, and nothing else. The starting lives are `20` at all three,
// interest is paid at all three, the whole floor is buildable at all three, and
// the per-wave hp scaling is the same at all three." Its table says the same in
// columns: the three Containment rows differ in two entries and agree in four.
//
// SO THIS CHECK READS THE FOUR THAT MUST AGREE, at all three difficulties. The
// two that differ are `modes.containment-easy`, `-medium` and `-hard`; this one
// never looks at them.
//
// THREE OF THE FOUR ARE FIGURES THE ROW ITSELF STATES — `startLives` at `20`,
// `interest` true, `buildZone` null — so each is read against the figure
// `specs/modes.md` gives it, at every difficulty.
//
// THE FOURTH IS NOT A FIGURE THIS FILE MAY NAME. `specs/modes.md` says only that
// the per-wave hp scaling is THE SAME at all three; what that scaling IS belongs
// to `specs/waves.md`, and `surge.hp-scales-with-the-wave` is the item that
// decides it. So the reading here is a COMPARISON BETWEEN THE THREE and never
// against an absolute: a Mote is added on the same wave at each difficulty, the
// factor its `maxHp` carries over the base hp `specs/surge.md` gives its type is
// computed, and the three factors must be one figure. A build whose formula is
// wrong but difficulty-blind fails the surge item and passes this one, which is
// the correct pair of verdicts; a build that scaled hp by the difficulty at all
// reads a different factor at two of the three and fails here.
//
// THE WAVE THE SCALING IS READ ON is `SCALING_WAVE`, deliberately not Wave 1:
// `specs/waves.md`'s factor is exactly `1` there, so a build that dropped the
// scaling entirely and one that keeps it agree at Wave 1 and the comparison would
// be vacuous. Every difficulty runs at least fifteen waves, so the wave is a
// legal one on all three.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertNull, assertTrue } from "../assert";
import {
  DIFFICULTIES,
  START_LIVES,
  SURGE_DEFS,
  type DifficultyId,
} from "../constants";
import {
  captureStill,
  createHarness,
  poseWalker,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";

/**
 * The wave the hp scaling is read on.
 *
 * Past Wave 1, where `specs/waves.md`'s factor is exactly `1` and every build
 * agrees whatever it does, and well inside the fifteen waves the shortest run
 * carries.
 */
const SCALING_WAVE = 5;

/**
 * The type the factor is read off, and the base hp `specs/surge.md` gives it.
 *
 * One type at all three difficulties, so the comparison is between three
 * readings of the same quantity and the base hp divides out of it.
 */
const READ_TYPE = "mote";
const BASE_HP = SURGE_DEFS[READ_TYPE].hp;

/**
 * How closely the three factors must agree.
 *
 * Six decimals: each is one quotient of a reported `maxHp` by an exact decimal
 * constant, so three difficulties that scale identically land on one figure and
 * the only honest slack is the last bits of a double reassociated a different
 * way — some nine orders of magnitude under this. It is not room for a
 * difficulty-dependent scaling: the smallest such difference worth the name, one
 * difficulty a tenth harsher than another, is four decimal places wider.
 */
const FACTOR_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the lives, the interest, the build zone and the hp scaling alone", async () => {
  /** The factor each difficulty gave the same unit on the same wave. */
  const factors: { difficulty: DifficultyId; factor: number }[] = [];

  for (const difficulty of DIFFICULTIES as readonly DifficultyId[]) {
    await startRun(h, "containment", difficulty);
    await h.debug.setWave(SCALING_WAVE);
    // A plain entry, posed with nothing but its vent: `poseWalker` leaves the hp
    // its type and the current wave gave it, which is the one reading wanted
    // here. Nothing else about the unit is touched, and one frame is far too
    // little for it to walk out of the reading.
    const id = await poseWalker(h, READ_TYPE, "left");

    await h.advance(1);
    await captureStill(h, "unchanged");

    const snapshot = await h.snapshot();
    assertEqual(
      snapshot.difficulty,
      difficulty,
      `the difficulty the run was posed on (${difficulty})`,
    );
    assertEqual(
      snapshot.startLives,
      START_LIVES,
      `the starting lives at ${difficulty}`,
    );
    assertEqual(snapshot.interest, true, `interest paid at ${difficulty}`);
    assertNull(snapshot.buildZone, `the build zone at ${difficulty}`);

    const maxHp = requireUnit(
      snapshot,
      id,
      `the ${READ_TYPE} added at ${difficulty}`,
    ).maxHp;
    // Well-formedness before comparison: three readings agree vacuously if none
    // of them is a number at all.
    assertTrue(
      Number.isFinite(maxHp),
      `a numeric maximum hp for the ${READ_TYPE} added at ${difficulty}, read ${maxHp}`,
    );
    factors.push({ difficulty, factor: maxHp / BASE_HP });
  }

  // The rule itself: one factor, at all three.
  const [first, ...rest] = factors;
  for (const { difficulty, factor } of rest) {
    assertCloseTo(
      factor,
      first.factor,
      FACTOR_DIGITS,
      `the wave-${SCALING_WAVE} hp factor at ${difficulty}, against ${first.factor} at ${first.difficulty}`,
    );
  }
});
