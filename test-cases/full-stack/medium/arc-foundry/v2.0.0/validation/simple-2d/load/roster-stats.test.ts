// load/roster-stats — each Load type carries the figures its roster row gives.
//
// specs/enemies.md's roster fixes five figures per type, and this check reads
// four of them: the speed, the flying bit, the bounty and the leak value. A Mote
// walks at `60` and pays `1` and costs `1`; a Spark walks at `120`; a Slug at
// `38` costs `2` on a leak; a Cluster at `72`; a Filament at `85` and flies; a
// Dynamo at `30` pays `40` and costs `5`. The fifth figure, base health, is the
// one the per-wave scaling multiplies, and it has three checks of its own.
//
// TWO OF THE FOUR ARE READ, AND TWO ARE DRIVEN. `speed` and `flying` are on the
// snapshot and are read off a unit that is TRAVELLING, because the roster's
// speed is what a unit moves at. A bounty and a leak value are not reported
// anywhere: specs/economy.md defines each as what an event pays or costs, so one
// kill and one leak of every type are driven and the change each made is read on
// the frame it was removed.
//
// Both events run through the game's own systems on a field posed so nothing
// else can move either counter: one Capacitor, no refinement, no upgrade, and a
// held unit at the entry keeping the wave from clearing while a bounty is being
// read. The wave is deep enough for no reason but this: the health posed for a
// kill is `1` whatever the wave, so the wave number changes nothing here.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { LOAD_ROSTER } from "../../src/constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { bountyFor, leakFor, openField, type Grounded } from "./vitals";

/** Comfortably above the eleven Grid Integrity the six leaks below cost. */
const INTEGRITY = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pays each type's bounty, costs its leak, and moves it at its speed", async () => {
  openField(h, { wave: 1, charge: 0, integrity: INTEGRITY });

  const measured = await captureReplay(h, "roster", async () => {
    const rows: { bounty: number; grounded: Grounded }[] = [];
    for (const def of LOAD_ROSTER) {
      rows.push({
        bounty: await bountyFor(h, def.type),
        grounded: await leakFor(h, def.type),
      });
    }
    return rows;
  });

  for (const [index, def] of LOAD_ROSTER.entries()) {
    const row = measured[index]!;
    assertEqual(
      row.bounty,
      def.bounty,
      `killing a ${def.type} pays its bounty of ${def.bounty} Charge`,
    );
    assertEqual(
      row.grounded.leak,
      def.leak,
      `a ${def.type} grounding out costs its leak of ${def.leak} Grid Integrity`,
    );
    assertCloseTo(
      row.grounded.baseSpeed,
      def.speed,
      6,
      `a ${def.type}'s roster speed`,
    );
    assertCloseTo(
      row.grounded.speed,
      def.speed,
      6,
      `a ${def.type} carrying no slow moves at its roster speed`,
    );
    assertEqual(
      row.grounded.flying,
      def.flies,
      `a ${def.type} ${def.flies ? "flies" : "walks"}`,
    );
  }
});
