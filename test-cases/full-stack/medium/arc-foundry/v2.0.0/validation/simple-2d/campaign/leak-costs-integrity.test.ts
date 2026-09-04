// campaign/leak-costs-integrity — a leak costs its unit's leak value.
//
// specs/economy.md: "A unit that reaches the collector grounds out, costs its
// leak value in Grid Integrity, and is removed. Leak values are in
// `specs/enemies.md`: most units `1`, a Slug `2`, and a Dynamo `5`."
// specs/enemies.md says the same from the unit's side: "A unit that grounds out
// leaks, costing the player its leak value in Grid Integrity."
//
// Each of the six roster types is released three tiles short of the collector,
// heading for it, and walks the rest of the way under the game's own pathfinder;
// the Grid Integrity is read on the frame the unit is removed. What is measured
// is what that one grounding cost.
//
// NOTHING ELSE CAN MOVE THE COUNTER. specs/economy.md gives Grid Integrity
// exactly one mover — a leak — and states that it "never regenerates", so the
// yard needs nothing on it at all: no component, no tower, no other unit but the
// held one that keeps the wave from clearing between the six readings. The
// opening figure is posed high enough that the eleven the six leaks cost cannot
// reach `0`, because a run that ended in defeat halfway through would stop the
// reading rather than fail it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LOAD_ROSTER } from "../constants";
import {
  captureReplay,
  createHarness,
  holdWave,
  openYard,
  type Harness,
} from "../harness";
import { leakOne } from "./runs";

/** Comfortably above the eleven Grid Integrity the six leaks below cost. */
const INTEGRITY = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("costs each roster type's leak value on the frame it grounds out", async () => {
  openYard(h, { wave: 1, integrity: INTEGRITY });
  holdWave(h);

  const cost = await captureReplay(h, "leak", async () => {
    const rows: number[] = [];
    for (const def of LOAD_ROSTER) {
      const before = h.snapshot().integrity;
      const grounded = await leakOne(h, def.type);
      rows.push(before - grounded.integrity);
    }
    return rows;
  });

  for (const [index, def] of LOAD_ROSTER.entries()) {
    assertEqual(
      cost[index],
      def.leak,
      `a ${def.type} grounding out costs ${def.leak} Grid Integrity`,
    );
  }
});
