// load/bounty-constant-across-waves — a kill pays the same bounty at wave 40 as at wave 1.
//
// specs/enemies.md, among the rules every unit obeys: "Only health scales across
// waves. Speeds, bounties, and leak values are constant for the whole run."
//
// THREE POINTS READ THAT SENTENCE — a speed, a bounty and a leak value — because a
// build can scale one of the three and leave the other two alone: scaling a bounty
// with the wave is the natural thing to do to keep a late run solvent, and it
// should not cost the same single point as scaling all three.
//
// WHAT IS DECIDED HERE is the bounty, driven as one kill of every roster type at
// each of the two waves. The field `load/vitals.ts` poses is what makes it a
// verdict: one Capacitor, no refinement, no upgrade, and the wave's own
// clear-and-pay resolution held, so nothing but the unit being read can move the
// bank.

// THE CONTROL. `healthStillScales` is taken at the end, so a run where the
// per-wave scaling was never applied at all fails here rather than passing on a
// yard where nothing moved between the two waves.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LOAD_ROSTER } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { bountyFor, openField, VITALS_HZ } from "./vitals";
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

/** One kill of every type at the wave the field is posed at. */
async function read(wave: number): Promise<Map<string, number>> {
  openField(h, {
    difficulty: DIFFICULTY,
    wave,
    charge: 0,
    integrity: INTEGRITY,
  });
  const rows = new Map<string, number>();
  for (const def of LOAD_ROSTER) {
    rows.set(def.type, await bountyFor(h, def.type));
  }
  return rows;
}

it("pays every roster bounty unchanged from wave 1 to wave 40", async () => {
  const shallow = await read(SHALLOW);
  const deep = await read(DEEP);

  for (const def of LOAD_ROSTER) {
    assertEqual(
      deep.get(def.type)!,
      shallow.get(def.type)!,
      `a ${def.type}'s bounty at wave ${DEEP} against wave ${SHALLOW}'s`,
    );
    assertEqual(
      deep.get(def.type)!,
      def.bounty,
      `a ${def.type}'s bounty at wave ${DEEP}, from the roster`,
    );
  }

  await healthStillScales(h);
  captureStill(h, "constant");
});
