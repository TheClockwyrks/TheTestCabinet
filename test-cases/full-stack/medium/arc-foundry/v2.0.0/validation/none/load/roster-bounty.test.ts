// load/roster-bounty — killing each Load type pays the bounty its roster row gives.
//
// `specs/enemies.md`'s roster fixes a bounty per type — a Mote pays `1`, a Dynamo
// pays `40` — and `specs/economy.md` defines what that figure IS: "Kill bounty:
// the killed unit's bounty from specs/enemies.md, paid the instant it is
// removed". A bounty is reported nowhere, so it is driven: one kill of every type
// on a field posed so nothing else can move the counter, and the Charge that
// arrived on the frame the unit was removed is the reading.
//
// THE FIELD. One Capacitor and one unit, no refinement, no upgrade, and
// `setWaveHold` holding the wave's own clear-and-pay resolution — because a clear
// pays a bonus into the same counter and would be indistinguishable from the
// bounty it landed on top of. The `1`-health pose is what makes the kill land on
// the first shot whatever the unit and whatever the wave: `setUnitHp` "never
// changes the maximum, so the unit stays the same type at the same wave scaling"
// (specs/instrumentation.md), so what is killed is a real unit of that type and
// not a weaker one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LOAD_ROSTER } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { bountyFor, openField } from "./vitals";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("pays each roster type's bounty on the frame the kill lands", async () => {
  await openField(h, { wave: 1, charge: 0 });

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
