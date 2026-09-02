// sigils/manifold-waits-on-empty-center — no center, no manifold.
//
// THE RULE. `manifold` acts "WHEN THE CENTER HOLDS A MOTE, each reach hex that
// also holds a mote is bound to the center" (`specs/sigils.md`), and "A sigil
// whose condition does not hold at a boundary waits". Every filament the rule
// creates runs from a reach TO THE CENTER, so with nothing on the center there is
// nothing for any reach to be bound to, however many reaches hold motes.
//
// THE CONFIGURATION. One `manifold` anchored on `(0, 0)` at rotation `0`, its
// center LEFT EMPTY, and a `dust` on each of its three reaches — `(1, 0)`,
// `(-1, 1)` and `(0, -1)`. All three occupied is the strongest arrangement the
// item names ("however many of its reach hexes hold motes"): a build that binds
// reaches to each other, or that treats an empty center as a mote of its own, has
// the most to work with and still must create nothing. Nothing else is placed and
// nothing else is on the field.
//
// NOTHING MOVES AND NOTHING COLLIDES: a sigil carries no tape, and the three motes
// rest `83.14` apart, above `2 * MOTE_COLLIDE_R` (`38`).
//
// THE VERDICT. No filament at all after the boundary, the center still empty, and
// each of the three motes still resting on its own reach as a constellation of
// one. The cycle counter is read too, so a build that froze rather than waited is
// not mistaken for one that waited.

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

/** Where the manifold is engraved. */
const ANCHOR = at(0, 0);

/** The `center` hex of `manifold`'s footprint, placed: left empty. */
const CENTER = place(at(0, 0), ANCHOR, 0);

/** The three `reach` hexes of `manifold`'s footprint, placed. */
const REACHES: readonly Hex[] = [at(1, 0), at(-1, 1), at(0, -1)].map((hex) =>
  place(hex, ANCHOR, 0),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates nothing with an empty center, though all three reaches hold motes", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("manifold", ANCHOR.q, ANCHOR.r, 0)]),
  });
  const reached: number[] = [];
  for (const hex of REACHES) reached.push(await spawnMote(h, hex, "dust"));

  const before = await h.snapshot();
  assertNotNull(
    solePartOfKind(before, "manifold"),
    "the machine carries the one manifold the check placed",
  );
  assertNull(
    moteAt(before, CENTER),
    "the center holds nothing when the boundary runs",
  );
  assertLength(
    before.sim?.motes ?? [],
    3,
    "the three motes on the reaches are the only motes on the field",
  );

  await advanceCycles(h, 1);
  // The verdict is the state the BOUNDARY left. The frame after it is only
  // what puts the picture on the canvas for the evidence below.
  const snapshot = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "no-center");
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(
    sim?.status,
    "running",
    "an unsatisfied manifold waits, and waiting halts nothing",
  );
  assertNull(sim?.fault ?? null, "no fault is raised: nothing moves");
  assertEqual(sim?.cycle, 1, "the cycle reached its boundary");

  assertLength(
    sim?.filaments ?? [],
    0,
    "the center holds no mote, so the manifold's condition never held and it created nothing",
  );
  assertNull(
    moteAt(snapshot, CENTER),
    "the center is still empty: a manifold spawns nothing",
  );
  for (const [index, hex] of REACHES.entries()) {
    const mote = reached[index] ?? -1;
    assertDeepEqual(
      constellationOf(snapshot, mote),
      [mote],
      `the mote on the reach at (${hex.q}, ${hex.r}) is still a constellation of one`,
    );
    const found = moteById(snapshot, mote);
    assertEqual(
      `${found?.q},${found?.r}`,
      `${hex.q},${hex.r}`,
      `the mote on the reach at (${hex.q}, ${hex.r}) is still resting on its own hex`,
    );
  }
});
