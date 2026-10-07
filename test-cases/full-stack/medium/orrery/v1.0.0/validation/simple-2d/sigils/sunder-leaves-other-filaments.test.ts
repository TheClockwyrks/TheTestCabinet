// sigils/sunder-leaves-other-filaments — a `sunder` removes ONE filament: the one
// joining the motes on its own two hexes.
//
// THE RULE. "When a filament joins the motes on its two hexes, that filament is
// removed, whatever its weight" (`specs/sigils.md`, Sundering). The sentence
// names one filament — "that filament" — and the footprint that picks it out is
// `(0, 0)` first and `(1, 0)` second. Nothing in it reaches a filament either
// mote carries to somewhere else, and `specs/field.md` makes those filaments
// ordinary members of the same constellation: "a constellation is a maximal group
// of motes connected by filaments".
//
// THE CONFIGURATION. A `sunder` anchored at `(0, 0)`, so its first hex is
// `(0, 0)` and its second is `(1, 0)`. A chain of four `dust` running east on
// `(-1, 0)`, `(0, 0)`, `(1, 0)` and `(2, 0)`, joined west to east by three
// filaments, and nothing else on the field. The chain reaches one hex PAST the
// sunder at each end, so two of its three filaments touch a mote on a sunder hex
// without joining the sunder's own pair:
//
//   (-1,0) --a-- (0,0) --b-- (1,0) --c-- (2,0)
//                first        second
//
// Filament `b` is the one joining the motes on the sunder's two hexes. `a` and
// `c` each have one end on a sunder hex and one end off it.
//
// THE VERDICT. After the boundary `b` is gone and `a` and `c` are both still
// there, each still carrying the weight it was given, and the field holds exactly
// two filaments. The removal of `b` is what says the sigil acted at all, so this
// check cannot be passed by a build whose sigil phase does nothing.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field, the one
// part is a sigil, and a sigil carries no tape — so nothing moves and the only
// change across the boundary is the sigil phase's.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  filamentBetween,
  openBareRun,
  spawnConstellation,
  type Harness,
} from "../harness";

let h: Harness;

/** The four hexes of the chain, west to east: the middle two are the sunder's. */
const WEST_END = at(-1, 0);
const FIRST = ORIGIN;
const SECOND = at(1, 0);
const EAST_END = at(2, 0);

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the filament joining its own pair and leaves the rest of the constellation joined", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("sunder", FIRST.q, FIRST.r, 0)]),
  });

  const chain = await spawnConstellation(
    h,
    [
      { hex: WEST_END, type: "dust" },
      { hex: FIRST, type: "dust" },
      { hex: SECOND, type: "dust" },
      { hex: EAST_END, type: "dust" },
    ],
    [
      { a: 0, b: 1, weight: 1 },
      { a: 1, b: 2, weight: 1 },
      { a: 2, b: 3, weight: 1 },
    ],
  );
  const westEnd = chain[0] as number;
  const first = chain[1] as number;
  const second = chain[2] as number;
  const eastEnd = chain[3] as number;

  const before = await h.snapshot();

  await advanceCycles(h, 1);
  await captureStill(h, "one-cut");

  assertLength(
    before.sim?.filaments ?? [],
    3,
    "the chain starts with three filaments, one of them joining the sunder's own pair",
  );
  assertNotNull(
    filamentBetween(before, first, second),
    "and the sunder's two hexes start joined, which is the condition it acts on",
  );

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "nothing on the field moves, so the cycle reaches its boundary",
  );
  assertEqual(after.sim?.cycle, 1, "and the boundary really ran");

  assertNull(
    filamentBetween(after, first, second),
    "the filament joining the motes on the sunder's own two hexes is removed",
  );
  const west = filamentBetween(after, westEnd, first);
  assertNotNull(
    west,
    "the filament from the first hex's mote to the mote west of the footprint survives",
  );
  assertEqual(west?.weight, 1, "and carries the weight it was given");
  const east = filamentBetween(after, second, eastEnd);
  assertNotNull(
    east,
    "the filament from the second hex's mote to the mote east of the footprint survives",
  );
  assertEqual(east?.weight, 1, "and carries the weight it was given");
  assertLength(
    after.sim?.filaments ?? [],
    2,
    "so exactly one filament was removed, out of three",
  );
});
