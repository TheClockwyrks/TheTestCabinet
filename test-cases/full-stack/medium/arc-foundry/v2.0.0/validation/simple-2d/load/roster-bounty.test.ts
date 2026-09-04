// load/roster-bounty — killing each Load type pays the bounty its roster row gives.
//
// `specs/enemies.md`'s roster fixes a bounty per type, and `specs/economy.md` pays
// it "the instant it is removed": a Mote, a Spark and a Cluster pay `1`, a Filament
// `2`, a Slug `3` and a Dynamo `40`.
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
import { bountyFor, openField } from "./vitals";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pays each roster type's bounty on the frame the kill lands", async () => {
  openField(h, { wave: 1, charge: 0 });

  const paid = await captureReplay(h, "bounty", async () => {
    const rows: number[] = [];
    for (const def of LOAD_ROSTER) rows.push(await bountyFor(h, def.type));
    return rows;
  });

  for (const [index, def] of LOAD_ROSTER.entries()) {
    assertEqual(
      paid[index],
      def.bounty,
      `killing a ${def.type} pays its bounty of ${def.bounty} Charge`,
    );
  }
});
