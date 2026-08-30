// load/only-health-scales — the roster's other figures are constant for the run.
//
// specs/enemies.md, among the rules every unit obeys: "Only health scales across
// waves. Speeds, bounties, and leak values are constant for the whole run." The
// per-wave scaling formula in the same file multiplies `baseHP` and nothing
// else, and specs/difficulty.md fixes the four constants it uses as "the only
// thing difficulty changes about a unit".
//
// So the same three figures are read at wave `1` and again at wave `40`, on the
// same run, and held against each other and against the roster. A build that
// scaled a bounty with the wave — the natural thing to do to keep a late run
// solvent — passes every health check and fails here.
//
// A speed is read off a unit that is travelling, and a bounty and a leak are
// driven as one kill and one leak of every type, on a field posed so that
// nothing else can move either counter: one Capacitor, no refinement, no
// upgrade, and a held unit at the entry keeping the live wave from clearing
// while a bounty is being read. The health that DOES scale is read alongside
// them, so a build that changed nothing at all between the two waves fails here
// too rather than passing on a run where the scaling was never applied.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import { LOAD_ROSTER } from "../../src/constants";
import {
  captureStill,
  createHarness,
  difficultyById,
  loadDef,
  openYard,
  releaseUnit,
  scaledHp,
  unitById,
  type Harness,
} from "../harness";
import { bountyFor, leakFor, openField, type Grounded } from "./vitals";

const DIFFICULTY = "medium";

/** The two waves the figures are compared across. */
const SHALLOW = 1;
const DEEP = 40;

/** Comfortably above the eleven Grid Integrity six leaks cost, twice over. */
const INTEGRITY = 400;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** One kill and one leak of every type, at the wave the field is posed at. */
async function readRoster(
  wave: number,
): Promise<Map<string, { bounty: number; grounded: Grounded }>> {
  openField(h, {
    difficulty: DIFFICULTY,
    wave,
    charge: 0,
    integrity: INTEGRITY,
  });
  const rows = new Map<string, { bounty: number; grounded: Grounded }>();
  for (const def of LOAD_ROSTER) {
    rows.set(def.type, {
      bounty: await bountyFor(h, def.type),
      grounded: await leakFor(h, def.type),
    });
  }
  return rows;
}

it("holds every speed, bounty and leak value from wave 1 to wave 40", async () => {
  const shallow = await readRoster(SHALLOW);
  const deep = await readRoster(DEEP);

  for (const def of LOAD_ROSTER) {
    const low = shallow.get(def.type)!;
    const high = deep.get(def.type)!;

    assertEqual(
      high.bounty,
      low.bounty,
      `a ${def.type}'s bounty at wave ${DEEP} against wave ${SHALLOW}'s`,
    );
    assertEqual(
      high.bounty,
      def.bounty,
      `a ${def.type}'s bounty at wave ${DEEP}, from the roster`,
    );
    assertEqual(
      high.grounded.leak,
      low.grounded.leak,
      `a ${def.type}'s leak at wave ${DEEP} against wave ${SHALLOW}'s`,
    );
    assertEqual(
      high.grounded.leak,
      def.leak,
      `a ${def.type}'s leak value at wave ${DEEP}, from the roster`,
    );
    assertCloseTo(
      high.grounded.baseSpeed,
      low.grounded.baseSpeed,
      6,
      `a ${def.type}'s speed at wave ${DEEP} against wave ${SHALLOW}'s`,
    );
    assertCloseTo(
      high.grounded.baseSpeed,
      def.speed,
      6,
      `a ${def.type}'s speed at wave ${DEEP}, from the roster`,
    );
  }

  // And health, the one figure that does scale, to separate a run that held
  // every figure constant from one that changed nothing at all.
  openYard(h, { difficulty: DIFFICULTY, wave: DEEP });
  const id = releaseUnit(h, "mote", { frozen: true });
  await h.advance(1);
  captureStill(h, "constant");

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
});
