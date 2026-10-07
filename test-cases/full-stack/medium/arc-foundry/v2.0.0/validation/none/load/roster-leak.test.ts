// load/roster-leak — each Load type grounding out costs the leak its roster row
// gives.
//
// `specs/enemies.md`'s roster fixes a leak value per type — a Mote costs `1`, a
// Slug `2`, a Dynamo `5` — and `specs/economy.md` defines what that figure IS: "A
// unit that reaches the collector grounds out, costs its leak value in Grid
// Integrity, and is removed." A leak value is reported nowhere, so it is driven:
// one leak of every type, walked in on its own legs, and the Grid Integrity that
// went on the frame the unit was removed is the reading.
//
// THE FIELD. Grid Integrity has exactly one mover, a leak, and it never
// regenerates, so nothing but the unit being read can touch it. The gun on the
// field is `310` units from the stretch a leak is walked over, well past its `100`
// reach, so the unit walking in is never shot at.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LOAD_ROSTER } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { leakFor, openField } from "./vitals";

/** Comfortably above the eleven Grid Integrity the six leaks below cost. */
const INTEGRITY = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("costs each roster type's leak value on the frame it grounds out", async () => {
  await openField(h, { wave: 1, integrity: INTEGRITY });

  const cost = await captureReplay(h, "leak", async () => {
    const rows: number[] = [];
    for (const def of LOAD_ROSTER) rows.push((await leakFor(h, def.type)).leak);
    return rows;
  });

  for (const [index, def] of LOAD_ROSTER.entries()) {
    assertEqual(
      cost[index],
      def.leak,
      `a ${def.type} grounding out costs its leak of ${def.leak} Grid Integrity`,
    );
  }
});
