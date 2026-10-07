// load/roster-flying — each Load type flies, or walks, as its roster row says.
//
// `specs/enemies.md`'s roster fixes the flying bit per type, and only the Filament
// carries it: every other type of the six is a ground unit. The bit is what decides
// whether the maze applies to a unit at all (`specs/pathing.md`), so a build that
// flies the wrong type has built a different game on every map.
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
import { captureStill, createHarness, type Harness } from "../harness";
import { VITALS_HZ, leakFor, openField, walkOne } from "./vitals";

/** Comfortably above the eleven Grid Integrity the six walks below cost. */
const INTEGRITY = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: VITALS_HZ });
});

afterEach(() => {
  h.dispose();
});

it("flies exactly the roster types that carry the flying bit", async () => {
  openField(h, { wave: 1, integrity: INTEGRITY });

  const rows = [];
  for (const def of LOAD_ROSTER) rows.push(await leakFor(h, def.type));

  // A still of one type on the same walk every reading above was taken off.
  openField(h, { wave: 1, integrity: INTEGRITY });
  walkOne(h, LOAD_ROSTER[0]!.type);
  await h.advance(1);
  captureStill(h, "flying");

  for (const [index, def] of LOAD_ROSTER.entries()) {
    assertEqual(
      rows[index]!.flying,
      def.flies,
      `a ${def.type} ${def.flies ? "flies" : "walks"}`,
    );
  }
});
