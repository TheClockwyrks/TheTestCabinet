// campaign/kill-bounty — a kill pays exactly its bounty, the instant it lands.
//
// specs/economy.md's income table: "Kill bounty — The killed unit's bounty from
// `specs/enemies.md`, paid the instant it is removed." The roster fixes the six
// figures: `1` for a Mote, a Spark and a Cluster, `2` for a Filament, `3` for a
// Slug and `40` for a Dynamo.
//
// Each of the six is killed by a real shot from a real component and the Charge
// is read on the frame the unit is removed, so what is measured is the payment
// the kill made rather than a total at the end.
//
// NOTHING ELSE CAN MOVE THE COUNTER. specs/economy.md gives Charge exactly two
// incomes and two sinks: a bounty, the wave-clear bonus, refining the press and
// upgrading a tower. The yard here carries one Capacitor and no tower, nothing
// refines, and a held unit at the entry keeps the live wave from clearing while
// the six kills are read — a bonus landing mid-reading would be
// indistinguishable from the bounty it landed on top of. What is left is the
// bounty.
//
// The `1`-health pose is what makes the kill land on the first shot whatever the
// unit and whatever the wave: `setUnitHp` "never changes the maximum, so the unit
// stays the same type at the same wave scaling" (specs/instrumentation.md), so
// what is killed is a real unit of that type and not a weaker one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LOAD_ROSTER } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  holdWaveOpen,
  openYard,
  type Harness,
} from "../harness";
import { killOne, standGun } from "./runs";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pays each roster type's bounty on the frame the kill lands", async () => {
  openYard(h, { wave: 1, charge: 0 });
  holdWaveOpen(h);
  standGun(h);

  const paid = await captureReplay(h, "kill", async () => {
    const rows: number[] = [];
    for (const def of LOAD_ROSTER) rows.push(await killOne(h, def.type));
    return rows;
  });

  for (const [index, def] of LOAD_ROSTER.entries()) {
    assertEqual(
      paid[index],
      def.bounty,
      `killing a ${def.type} pays ${def.bounty} Charge`,
    );
  }
});
