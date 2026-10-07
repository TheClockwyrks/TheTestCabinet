// sigils/wane-keeps-filaments — a mote dimmed by `wane` keeps every filament it
// carried and stays in the same constellation. Only its type changes.
//
// THE RULE. "An essence mote on the seat becomes `dust`. Its filaments, its
// constellation, and any hold on it are untouched" (`specs/sigils.md`,
// Transmuting sigils). The second sentence is the requirement here, and
// `specs/field.md` says what a constellation is made of: "a maximal group of
// motes connected by filaments", each filament carrying "a `weight` of `1` or
// `3`".
//
// THE CONFIGURATION. A `wane` anchored at `(0, 0)`, whose one footprint hex is
// its seat. A `nova` on that seat with a `dust` on each side of it — `(1, 0)` to
// the east and `(-1, 0)` to the west, both adjacent to the seat — joined to it by
// two filaments of DIFFERENT weights: a plain `1` east and a `3` west. Two
// weights, because "every filament it carried" is a claim about the filaments as
// they were, weights included, and one weight could not tell a build that keeps
// them from a build that replaces them. Neither neighbour is on a sigil hex: the
// `wane`'s footprint is the seat alone.
//
// THE VERDICT. After one cycle the seat's mote is `dust`; both filaments are
// still there, still joining the same pairs at the same weights; the field
// carries exactly those two; and the constellation the run reports for the dimmed
// mote is still all three motes. The change of type is read back too, so a build
// that simply never ran its sigil phase does not pass.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field, the one
// part is a sigil, and a sigil carries no tape — so nothing moves.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
} from "../assert";
import { at } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  constellationOf,
  createHarness,
  filamentBetween,
  moteById,
  openBareRun,
  spawnConstellation,
  type Harness,
} from "../harness";

let h: Harness;

/** The seat, and the two hexes adjacent to it along `r = 0`. */
const SEAT = ORIGIN;
const EAST_OF_SEAT = at(1, 0);
const WEST_OF_SEAT = at(-1, 0);

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("dims a bonded essence and leaves its filaments and its constellation alone", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("wane", SEAT.q, SEAT.r, 0)]),
  });

  const group = await spawnConstellation(
    h,
    [
      { hex: SEAT, type: "nova" },
      { hex: EAST_OF_SEAT, type: "dust" },
      { hex: WEST_OF_SEAT, type: "dust" },
    ],
    [
      { a: 0, b: 1, weight: 1 },
      { a: 0, b: 2, weight: 3 },
    ],
  );
  const seated = group[0] as number;
  const east = group[1] as number;
  const west = group[2] as number;
  const whole = [seated, east, west].sort((a, b) => a - b);

  const before = await h.snapshot();

  await advanceCycles(h, 1);
  await captureStill(h, "bonded-wane");

  assertEqual(
    moteById(before, seated)?.type,
    "nova",
    "the seat starts holding an essence, which is the condition wane acts on",
  );
  assertDeepEqual(
    constellationOf(before, seated),
    whole,
    "and the three motes start as one constellation",
  );

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "nothing on the field moves, so the cycle reaches its boundary",
  );
  assertEqual(
    moteById(after, seated)?.type,
    "dust",
    "the essence on the seat became dust, so the sigil acted",
  );

  const plain = filamentBetween(after, seated, east);
  assertNotNull(plain, "the filament east of the seat survives the boundary");
  assertEqual(plain?.weight, 1, "and still carries the weight 1 it was given");
  const triune = filamentBetween(after, seated, west);
  assertNotNull(triune, "the filament west of the seat survives the boundary");
  assertEqual(triune?.weight, 3, "and still carries the weight 3 it was given");
  assertLength(
    after.sim?.filaments ?? [],
    2,
    "and those two are the whole of the field's filaments: none was added or removed",
  );

  assertDeepEqual(
    constellationOf(after, seated),
    whole,
    "so the dimmed mote is still in the same constellation, all three motes of it",
  );
  assertEqual(
    moteById(after, east)?.type,
    "dust",
    "the neighbour east of the seat, on no sigil hex, is untouched",
  );
  assertEqual(
    moteById(after, west)?.type,
    "dust",
    "and so is the neighbour west of it",
  );
});
