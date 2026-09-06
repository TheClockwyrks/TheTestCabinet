// load/roster-bounty — each Load type pays the bounty its roster row gives.
//
// `specs/enemies.md`'s roster fixes five figures per type, and each is a
// requirement of its own: a build that pays the wrong bounty and a build that
// walks a type at the wrong speed have missed different things, and a grade that
// named "the roster" would say neither. So each figure is decided by a check of
// its own, table-driven over the six types the roster carries, because one type's
// figure is read exactly the way the next one's is. The fifth, base health, is the
// one the per-wave scaling multiplies and has three checks of its own.
//
// THIS ONE IS ABOUT THE BOUNTY. `specs/economy.md` defines it as an event rather than a
// reading — "Kill bounty: the killed unit's bounty from specs/enemies.md, paid the
// instant it is removed" — so one kill of every type is driven and the Charge the
// death paid is read on the frame the unit was removed.
//
// NOTHING ELSE CAN MOVE THE COUNTER. Charge has exactly two incomes and two sinks
// (`specs/economy.md`): a bounty, the wave-clear bonus, refining the press and
// upgrading a tower. The yard carries one Capacitor and no tower, nothing refines,
// and `setWaveHold` holds the wave's own clear-and-pay resolution while the six
// kills are read — a bonus landing mid-reading would be indistinguishable from the
// bounty it landed on top of.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LOAD_ROSTER } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { bountyFor, openField, VITALS_HZ } from "./vitals";

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: VITALS_HZ });
});

afterEach(() => {
  h.dispose();
});

it("pays each roster type's bounty on the kill", async () => {
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
