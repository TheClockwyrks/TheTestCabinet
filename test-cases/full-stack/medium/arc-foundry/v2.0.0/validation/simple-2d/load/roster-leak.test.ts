// load/roster-leak — each Load type grounding out costs the leak value its roster
// row gives.
//
// `specs/enemies.md`'s roster fixes a leak value per type, and `specs/economy.md`
// charges it when a unit "reaches the collector, grounds out, costs its leak value
// in Grid Integrity, and is removed": most types cost `1`, a Slug `2`, and a
// Dynamo `5`.
//
// The four figures the roster fixes are read four ways, and each is a point of
// its own: a build that pays the wrong bounty and walks every type at the right
// speed has to grade differently from one that gets both wrong. `specs/enemies.md`
// holds all four in one table, and `constants.ts` transcribes it.
//
// TWO OF THE FOUR ARE READ AND TWO ARE DRIVEN. `speed` and `flying` are on the
// snapshot. A bounty and a leak value are not reported anywhere:
// `specs/economy.md` defines each as what an event pays or costs, so the event is
// driven and the change it made is read on the frame the unit was removed.
//
// The field `load/vitals.ts` poses is what makes either reading a verdict: one
// Capacitor, no refinement, no upgrade, and the wave's own clear-and-pay
// resolution held, so nothing but the unit being read can move either counter. The
// fifth roster figure, base health, is the one the per-wave scaling multiplies, and
// it has three checks of its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LOAD_ROSTER } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { leakFor, openField, VITALS_HZ } from "./vitals";

/** Comfortably above the eleven Grid Integrity the six leaks below cost. */
const INTEGRITY = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: VITALS_HZ });
});

afterEach(() => {
  h.dispose();
});

it("costs each roster type's leak value on the frame it grounds out", async () => {
  openField(h, { wave: 1, integrity: INTEGRITY });

  const grounded = await captureReplay(h, "leak", async () => {
    const rows = [];
    for (const def of LOAD_ROSTER) rows.push(await leakFor(h, def.type));
    return rows;
  });

  for (const [index, def] of LOAD_ROSTER.entries()) {
    assertEqual(
      grounded[index]!.leak,
      def.leak,
      `a ${def.type} grounding out costs its leak of ${def.leak} Grid Integrity`,
    );
  }
});
