// load/roster-flying — each Load type flies, or walks, as its roster row says.
//
// `specs/enemies.md`'s roster fixes five figures per type, and each is a
// requirement of its own: a build that pays the wrong bounty and a build that
// walks a type at the wrong speed have missed different things, and a grade that
// named "the roster" would say neither. So each figure is decided by a check of
// its own, table-driven over the six types the roster carries, because one type's
// figure is read exactly the way the next one's is. The fifth, base health, is the
// one the per-wave scaling multiplies and has three checks of its own.
//
// THIS ONE IS ABOUT THE FLYING BIT. `specs/enemies.md` gives it per type — the Filament is
// the one type that flies — and `specs/pathing.md` turns it into the rule that
// matters: a flying unit ignores the maze. The bit itself is on the snapshot, and
// it is read off a unit the spawner has just released on an otherwise empty yard.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LOAD_ROSTER } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { VITALS_HZ, travelling } from "./vitals";

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: VITALS_HZ });
});

afterEach(() => {
  h.dispose();
});

it("flies or walks each roster type as its row says", async () => {
  for (const def of LOAD_ROSTER) {
    openYard(h, { wave: 1 });
    assertEqual(
      travelling(h, def.type).flying,
      def.flies,
      `a ${def.type} ${def.flies ? "flies" : "walks"}`,
    );
  }
  await h.advance(1);
  captureStill(h, "flying");
});
