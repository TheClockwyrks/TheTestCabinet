// load/leak-constant-across-waves — a ground-out costs the same Grid Integrity at wave 40 as at wave 1.
//
// specs/enemies.md, among the rules every unit obeys: "Only health scales across
// waves. Speeds, bounties, and leak values are constant for the whole run."
//
// THREE POINTS READ THAT SENTENCE — a speed, a bounty and a leak value — because a
// build can scale one of the three and leave the other two alone: scaling a bounty
// with the wave is the natural thing to do to keep a late run solvent, and it
// should not cost the same single point as scaling all three.
//
// WHAT IS DECIDED HERE is the leak value, driven as one ground-out of every roster
// type at each of the two waves. Grid Integrity has exactly one mover and never
// regenerates, so nothing but the unit being read can touch it.

// THE CONTROL. `healthStillScales` is taken at the end, so a run where the
// per-wave scaling was never applied at all fails here rather than passing on a
// yard where nothing moved between the two waves.

// THE CLOCK. Twelve ground-outs is twelve walks of three tiles, and the walk is
// the whole cost of the check: what it decides is the Grid Integrity a leak took,
// which is a figure the collector pays once. The specification deliberately fixes
// no frame size — "an interval of simulation time reaches the same state however
// it was divided into frames and whatever frame rate produced it"
// (specs/instrumentation.md), which `instrumentation/frame-division-movement`
// decides — and nothing read here is a projectile: the Capacitor `openField`
// stands is `310` units from the walk, far outside its `100` reach, and the
// unit walks away from it. So the frames are taken at {@link HZ}, where the
// fastest unit in the roster still steps a fifth of a tile.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LOAD_ROSTER } from "../constants";
import { ConstantClock } from "@clockwyrks/simple-2d";
import { captureStill, createHarness, type Harness } from "../harness";
import { leakFor, openField } from "./vitals";
import {
  DEEP,
  DIFFICULTY,
  INTEGRITY,
  SHALLOW,
  healthStillScales,
} from "./constant";

/**
 * The frame rate the walks are taken at: `30` Hz, a quarter of this project's
 * default. The Spark, the roster's fastest unit at `120` units per second, still
 * steps `4` units a frame, a fifth of a tile.
 */
const HZ = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(1000 / HZ) });
});

afterEach(() => {
  h.dispose();
});

/** One leak of every type at the wave the field is posed at. */
async function read(wave: number): Promise<Map<string, number>> {
  openField(h, {
    difficulty: DIFFICULTY,
    wave,
    charge: 0,
    integrity: INTEGRITY,
  });
  const rows = new Map<string, number>();
  for (const def of LOAD_ROSTER) {
    rows.set(def.type, (await leakFor(h, def.type)).leak);
  }
  return rows;
}

it("costs every roster leak value unchanged from wave 1 to wave 40", async () => {
  const shallow = await read(SHALLOW);
  const deep = await read(DEEP);

  for (const def of LOAD_ROSTER) {
    assertEqual(
      deep.get(def.type)!,
      shallow.get(def.type)!,
      `a ${def.type}'s leak at wave ${DEEP} against wave ${SHALLOW}'s`,
    );
    assertEqual(
      deep.get(def.type)!,
      def.leak,
      `a ${def.type}'s leak value at wave ${DEEP}, from the roster`,
    );
  }

  await healthStillScales(h);
  captureStill(h, "constant");
});
