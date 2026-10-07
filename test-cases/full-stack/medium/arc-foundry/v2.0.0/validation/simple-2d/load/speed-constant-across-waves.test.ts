// load/speed-constant-across-waves — a unit walks at the same speed at wave 40 as at wave 1.
//
// specs/enemies.md, among the rules every unit obeys: "Only health scales across
// waves. Speeds, bounties, and leak values are constant for the whole run."
//
// THREE POINTS READ THAT SENTENCE — a speed, a bounty and a leak value — because a
// build can scale one of the three and leave the other two alone: scaling a bounty
// with the wave is the natural thing to do to keep a late run solvent, and it
// should not cost the same single point as scaling all three.
//
// WHAT IS DECIDED HERE is the speed, read off a unit of every roster type that is
// travelling, at each of the two waves.

// THE CONTROL. `healthStillScales` is taken at the end, so a run where the
// per-wave scaling was never applied at all fails here rather than passing on a
// yard where nothing moved between the two waves.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { LOAD_ROSTER } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { VITALS_HZ, openField, travelling } from "./vitals";
import {
  DEEP,
  DIFFICULTY,
  INTEGRITY,
  SHALLOW,
  healthStillScales,
} from "./constant";

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: VITALS_HZ });
});

afterEach(() => {
  h.dispose();
});

/** Every roster type's travelling speed at the wave posed. */
async function read(wave: number): Promise<Map<string, number>> {
  openField(h, {
    difficulty: DIFFICULTY,
    wave,
    charge: 0,
    integrity: INTEGRITY,
  });
  const rows = new Map<string, number>();
  for (const def of LOAD_ROSTER) {
    // Read off a unit that is TRAVELLING: the roster's speed is what a unit
    // moves at, and a unit that has been held is not one that is moving.
    rows.set(def.type, travelling(h, def.type).baseSpeed);
  }
  return rows;
}

it("walks every roster type at its own speed from wave 1 to wave 40", async () => {
  const shallow = await read(SHALLOW);
  const deep = await read(DEEP);

  for (const def of LOAD_ROSTER) {
    assertCloseTo(
      deep.get(def.type)!,
      shallow.get(def.type)!,
      6,
      `a ${def.type}'s speed at wave ${DEEP} against wave ${SHALLOW}'s`,
    );
    assertCloseTo(
      deep.get(def.type)!,
      def.speed,
      6,
      `a ${def.type}'s speed at wave ${DEEP}, from the roster`,
    );
  }

  await healthStillScales(h);
  captureStill(h, "constant");
});
