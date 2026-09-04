// load — the two waves the roster's constant figures are compared across.
// CASE-PROVIDED, LOCAL TO THIS CATEGORY.
//
// specs/enemies.md, among the rules every unit obeys: "Only health scales across
// waves. Speeds, bounties, and leak values are constant for the whole run." The
// per-wave scaling formula in the same file multiplies `baseHP` and nothing else,
// and specs/difficulty.md fixes the four constants it uses as "the only thing
// difficulty changes about a unit".
//
// THREE POINTS READ THAT SENTENCE — a speed, a bounty and a leak value — because
// a build can scale one of the three and leave the other two alone: scaling a
// bounty with the wave is the natural thing to do to keep a late run solvent, and
// it should not cost the same single point as scaling all three. This file holds
// the two waves, the field they are read on, and the control every one of them
// takes.

import { assertEqual, assertGreaterThan } from "../assert";
import { type Harness, openYard, releaseUnit, unitById } from "../harness";
import { difficultyById, loadDef, scaledHp } from "../constants";

export const DIFFICULTY = "medium";

/** The two waves every figure below is compared across. */
export const SHALLOW = 1;
export const DEEP = 40;

/** Comfortably above the eleven Grid Integrity six leaks cost, twice over. */
export const INTEGRITY = 400;

/**
 * The control every one of the three points takes: health DOES scale.
 *
 * Without it a run where the per-wave scaling was never applied at all would
 * satisfy each of them, because nothing would have moved between the two waves.
 */
export async function healthStillScales(h: Harness): Promise<void> {
  openYard(h, { difficulty: DIFFICULTY, wave: DEEP });
  const id = releaseUnit(h, "mote", { frozen: true });
  await h.advance(1);

  const deepHp = unitById(h.snapshot(), id).maxHp;
  assertEqual(
    deepHp,
    scaledHp(loadDef("mote").baseHealth, DEEP, difficultyById(DIFFICULTY)),
    `a Mote's scaled health at wave ${DEEP}`,
  );
  assertGreaterThan(
    deepHp,
    scaledHp(loadDef("mote").baseHealth, SHALLOW, difficultyById(DIFFICULTY)),
    `a Mote at wave ${DEEP} carries more health than one at wave ${SHALLOW}`,
  );
}
