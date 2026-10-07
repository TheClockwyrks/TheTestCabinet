// field/pattern-filaments-rotate-with-their-motes — a turned pattern arrives as
// one constellation, links and all.
//
// THE RULE, from `specs/field.md` (Molecule patterns): "each pattern coordinate is
// rotated about `(0, 0)` by the rotation, using the formulas above, then
// translated by the anchor. **Filament endpoints rotate the same way.**" And from
// `specs/sigils.md` (`rise`): "one new mote per pattern mote and one filament per
// pattern filament, at the placed pose, unheld". So a placed pattern is the whole
// pattern moved — the same pairs joined, at the same weights — rather than a set
// of motes that arrived turned with their links dropped or left on the hexes they
// started from.
//
// WHAT A FILAMENT AND A WEIGHT ARE. `specs/field.md`: "A filament is a rigid link
// between two motes on adjacent hexes. It carries a `weight` of `1` or `3`", and
// "A constellation is a maximal group of motes connected by filaments."
// `specs/formats.md` lets a molecule pattern carry either weight, so a pattern
// with one of each pins both that the pairs survive the turn and that the weights
// travel with them.
//
// THE CONFIGURATION. A chain of three, written in pattern coordinates as
// `(0, 0)` `nebula`, `(1, 0)` `comet`, `(2, 0)` `nova`, joined `(0, 0)`-`(1, 0)`
// at weight `1` and `(1, 0)`-`(2, 0)` at weight `3` — three distinct types, so
// each spawned mote says which pattern mote it is. The rise for it is anchored on
// `(1, -1)` at rotation `2`, a non-zero rotation as the review item requires. Two
// clockwise steps, `(q, r) -> (-r, q + r)` twice, take `(0, 0)` to `(0, 0)`,
// `(1, 0)` to `(-1, 1)` and `(2, 0)` to `(-2, 2)`; translated by the anchor those
// are `(1, -1)`, `(0, 0)` and `(-1, 1)`, all on the field and each adjacent to the
// next by `DIRS[2]`, which is what keeps the placed links legal links.
//
// WHERE IT BECOMES OBSERVABLE. Rises run at each boundary, "After the four waves"
// of the sigil phase (`specs/simulation.md`), so one cycle of game time is enough.
//
// THE WORLD IS EMPTY AROUND IT. The bare opener resets, poses the challenge, loads
// a machine that is this one rise, holds the completion switch off, starts the run
// and empties the field. Nothing moves and no other sigil is placed, so the three
// motes and the two filaments read back are the ones the rise created.
//
// THE VERDICT. Each pattern mote is on its turned hex; a filament joins the
// `nebula` to the `comet` at weight `1` and the `comet` to the `nova` at weight
// `3`; there are exactly two filaments; and all three motes are one constellation.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, place } from "../field";
import {
  challenge,
  link,
  loneMote,
  molecule,
  mote,
  risePart,
  solution,
} from "../formats";
import {
  advanceCycles,
  captureStill,
  constellationOf,
  createHarness,
  filamentBetween,
  looseMotes,
  moteAt,
  openBareRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The anchor and the non-zero rotation the placement is read at. */
const ANCHOR = at(1, -1);
const ROTATION = 2;

/** The pattern's three coordinates, in the order the molecule lists them. */
const HEAD = at(0, 0);
const MIDDLE = at(1, 0);
const TAIL = at(2, 0);

/** A chain of three, joined by a plain filament and a triune one. */
const BONDED_REAGENT = challenge({
  name: "Bonded Reagent",
  reagents: [
    molecule(
      [
        mote(HEAD.q, HEAD.r, "nebula"),
        mote(MIDDLE.q, MIDDLE.r, "comet"),
        mote(TAIL.q, TAIL.r, "nova"),
      ],
      [link(HEAD, MIDDLE, 1), link(MIDDLE, TAIL, 3)],
    ),
  ],
  products: [loneMote("nebula")],
  permitted: ["arm"],
});

it("spawns each pattern filament between the same two motes at their turned hexes", async () => {
  await openBareRun(h, {
    challenge: BONDED_REAGENT,
    machine: solution([risePart(0, ANCHOR.q, ANCHOR.r, ROTATION)]),
  });

  const bare = await h.snapshot();
  assertEqual(
    bare.sim?.motes.length,
    0,
    "the opener empties the field, so nothing stands where the reagent will appear",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "bonded");

  const snapshot = await h.snapshot();
  assertNotNull(snapshot.sim, "the run is live through the boundary");
  assertNull(
    snapshot.sim?.fault ?? null,
    "a machine that is one rise moves nothing, so nothing faults",
  );
  assertEqual(
    looseMotes(snapshot).length,
    3,
    "the reagent is one new mote per pattern mote, and this pattern holds three",
  );

  const head = moteAt(snapshot, place(HEAD, ANCHOR, ROTATION));
  const middle = moteAt(snapshot, place(MIDDLE, ANCHOR, ROTATION));
  const tail = moteAt(snapshot, place(TAIL, ANCHOR, ROTATION));
  assertNotNull(
    head,
    "the pattern mote on (0, 0) turned twice and translated lands on (1, -1)",
  );
  assertNotNull(
    middle,
    "the pattern mote on (1, 0) turned twice and translated lands on (0, 0)",
  );
  assertNotNull(
    tail,
    "the pattern mote on (2, 0) turned twice and translated lands on (-1, 1)",
  );
  assertEqual(
    head?.type,
    "nebula",
    "the head of the chain is the pattern's nebula",
  );
  assertEqual(
    middle?.type,
    "comet",
    "the middle of the chain is the pattern's comet",
  );
  assertEqual(
    tail?.type,
    "nova",
    "the tail of the chain is the pattern's nova",
  );

  assertEqual(
    snapshot.sim?.filaments.length,
    2,
    "one filament per pattern filament, and this pattern carries two",
  );
  assertEqual(
    filamentBetween(snapshot, head?.id ?? -1, middle?.id ?? -1)?.weight,
    1,
    "the pattern's (0, 0)-(1, 0) filament joins the same two motes at their turned hexes, at weight 1",
  );
  assertEqual(
    filamentBetween(snapshot, middle?.id ?? -1, tail?.id ?? -1)?.weight,
    3,
    "the pattern's (1, 0)-(2, 0) filament joins the same two motes at their turned hexes, at weight 3",
  );
  assertNull(
    filamentBetween(snapshot, head?.id ?? -1, tail?.id ?? -1),
    "the pattern joins no such pair, and a rise creates one filament per pattern filament and no more",
  );
  assertDeepEqual(
    constellationOf(snapshot, head?.id ?? -1),
    [head?.id ?? -1, middle?.id ?? -1, tail?.id ?? -1].sort((a, b) => a - b),
    "the filaments arrived with the motes, so the turned pattern is one constellation",
  );
});
