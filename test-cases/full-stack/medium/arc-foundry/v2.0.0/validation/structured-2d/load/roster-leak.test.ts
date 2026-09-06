// load/roster-leak — each Load type costs the leak value its roster row gives.
//
// `specs/enemies.md`'s roster fixes five figures per type, and each is a
// requirement of its own: a build that pays the wrong bounty and a build that
// walks a type at the wrong speed have missed different things, and a grade that
// named "the roster" would say neither. So each figure is decided by a check of
// its own, table-driven over the six types the roster carries, because one type's
// figure is read exactly the way the next one's is. The fifth, base health, is the
// one the per-wave scaling multiplies and has three checks of its own.
//
// THIS ONE IS ABOUT THE LEAK VALUE. `specs/economy.md` defines it as an event rather than
// a reading — "A unit that reaches the collector grounds out, costs its leak value
// in Grid Integrity, and is removed" — so one leak of every type is driven and the
// Grid Integrity it cost is read on the frame the unit was removed.
//
// NOTHING ELSE CAN MOVE THE COUNTER. Grid Integrity has exactly one mover, a leak,
// and it never regenerates (`specs/economy.md`), so nothing but the unit being read
// can touch it.

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

it("costs each roster type's leak value when it grounds out", async () => {
  openField(h, { wave: 1, integrity: INTEGRITY });

  const cost = await captureReplay(h, "leak", async () => {
    const rows: number[] = [];
    for (const def of LOAD_ROSTER) {
      rows.push((await leakFor(h, def.type)).leak);
    }
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
