// sigils/bind-waits-on-empty-hex — half a pair is not a pair.
//
// THE RULE. `bind` acts "When BOTH HEXES hold motes and no filament joins that
// pair" (`specs/sigils.md`), and "A sigil whose condition does not hold at a
// boundary waits". One mote and one empty hex is not both hexes holding motes, so
// the bind waits and no filament is created — and a filament could not be created
// in any case, `specs/field.md` making one "a rigid link between two motes".
//
// THE TWO ARRANGEMENTS. The mote on the `first` hex with the `second` empty, and
// the mote on the `second` hex with the `first` empty. Both are the one
// requirement, and posing both is what separates a build that reads its condition
// hex by hex from one that checks only the hex it happens to look at first. Each
// arrangement is posed on its own bare run.
//
// THE CONFIGURATION. One `bind` anchored on `(0, 0)` at rotation `0`, so its hexes
// are `(0, 0)` and `(1, 0)`, and one `dust` on one of them. Nothing else is placed
// and nothing else is on the field, so a filament reported afterwards could only
// have come from this bind.
//
// THE VERDICT. No filament at all, the mote still resting on its hex and still a
// constellation of one, and the run still running on the cycle it completed — the
// cycle counter is read so that a build which froze rather than waited is not
// mistaken for one that waited.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, place, type Hex } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  constellationOf,
  createHarness,
  moteAt,
  moteById,
  openBareRun,
  solePartOfKind,
  spawnMote,
  type Harness,
} from "../harness";

/** Where the bind is engraved. */
const ANCHOR = at(0, 0);

/** The `first` hex of `bind`'s footprint, placed. */
const FIRST = place(at(0, 0), ANCHOR, 0);

/** The `second` hex of `bind`'s footprint, placed. */
const SECOND = place(at(1, 0), ANCHOR, 0);

/** The two half-occupied arrangements, each named by the hex that holds the mote. */
const CASES: readonly { role: string; held: Hex; empty: Hex }[] = [
  { role: "first", held: FIRST, empty: SECOND },
  { role: "second", held: SECOND, empty: FIRST },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates no filament with one of its two hexes empty", async () => {
  for (const { role, held, empty } of CASES) {
    await openBareRun(h, {
      challenge: BARE,
      machine: solution([sigilPart("bind", ANCHOR.q, ANCHOR.r, 0)]),
    });
    const lone = await spawnMote(h, held, "dust");

    const before = await h.snapshot();
    assertNotNull(
      solePartOfKind(before, "bind"),
      `${role}: the machine carries the one bind the check placed`,
    );
    assertNull(
      moteAt(before, empty),
      `${role}: the other hex holds nothing when the boundary runs`,
    );

    await advanceCycles(h, 1);
    // The verdict is the state the BOUNDARY left. The frame after it is only
    // what puts the picture on the canvas for the evidence below.
    const snapshot = await h.snapshot();
    await h.advance(1);
    await captureStill(h, "half-empty");
    const sim = snapshot.sim;
    assertNotNull(sim, `${role}: the run is live through the cycle`);
    assertEqual(
      sim?.status,
      "running",
      `${role}: an unsatisfied bind waits, and waiting halts nothing`,
    );
    assertNull(
      sim?.fault ?? null,
      `${role}: no fault is raised: nothing moves`,
    );
    assertEqual(sim?.cycle, 1, `${role}: the cycle reached its boundary`);

    assertLength(
      sim?.filaments ?? [],
      0,
      `${role}: one hex empty is not both hexes holding motes, so the bind created nothing`,
    );
    assertDeepEqual(
      constellationOf(snapshot, lone),
      [lone],
      `${role}: the lone mote is still a constellation of one`,
    );
    const found = moteById(snapshot, lone);
    assertEqual(
      `${found?.q},${found?.r}`,
      `${held.q},${held.r}`,
      `${role}: the mote is still resting on the hex it was spawned on`,
    );
    assertNull(
      moteAt(snapshot, empty),
      `${role}: the empty hex is still empty: a bind moves nothing`,
    );
  }
});
