// sigils/ascend-requires-planet-crown — an `ascend` whose crown holds a mote that
// is not a planet leaves the `mercury` on its prime unspent.
//
// THE RULE. "When the prime holds an unbonded, unheld `mercury` and the crown
// holds a planet below `sol`, the `mercury` is consumed and the planet rises one
// rung of `PLANETS`" (`specs/sigils.md`, Transmuting sigils), and "a sigil whose
// condition does not hold at a boundary waits" (`specs/sigils.md`). A waiting
// sigil has no partial effect to give: the `mercury` is consumed only as part of
// raising a planet, so a crown that is not a planet leaves it standing.
//
// WHICH TYPES ARE PLANETS is `specs/field.md`'s: "`PLANETS` holds the ladder
// `saturn`, `jupiter`, `mars`, `venus`, `luna`, `sol` in that order". The sweep
// below is `MOTES` less `PLANETS` — `dust`, the four essences, `mercury`,
// `umbra`, `lumen` and `aether` — taken from those two rosters rather than listed
// by hand.
//
// THE CONFIGURATION. Nine `ascend` sigils, one per non-planet type, laid out as
// pairwise disjoint footprints across three rows of the field, each at rotation
// `0` so its prime is its anchor and its crown the hex east of it. Every prime
// holds a loose, unbonded, unheld `mercury`, so the prime half of the condition
// is satisfied in all nine and the crown is the only thing under test.
//
// AND ONE CONTROL, so a build whose sigil phase does nothing cannot pass. A tenth
// `ascend`, with `mercury` on its prime and `saturn` on its crown, which the same
// boundary must raise and whose `mercury` it must spend. It is a sigil of its own
// on hexes of its own and decides nothing about the nine; it is read back only to
// say that `ascend` acted at this boundary at all.
//
// THE VERDICT. After one cycle each of the nine primes still holds its `mercury`,
// resting where it was spawned, each crown still carries the type it was spawned
// with, and the control's crown is `jupiter` with its prime empty.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { MOTES, PLANETS, type MoteName } from "../constants";
import { at, neighbor, type Hex } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  moteAt,
  moteById,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

/** Every type the crown condition does not name: the roster less the ladder. */
const NOT_PLANETS: readonly MoteName[] = MOTES.filter(
  (type) => !(PLANETS as readonly MoteName[]).includes(type),
);

/**
 * Ten anchors — one per case, plus the control — whose footprints are pairwise
 * disjoint: each takes its anchor and the hex east of it, and the rows are two
 * apart so no two footprints can meet.
 */
const ANCHORS: readonly Hex[] = [
  at(-1, -4),
  at(1, -4),
  at(3, -4),
  at(-3, -2),
  at(-1, -2),
  at(1, -2),
  at(3, -2),
  at(-5, 0),
  at(-3, 0),
  at(-1, 0),
];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spends no mercury when the crown holds anything but a planet", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution(
      ANCHORS.map((anchor) => sigilPart("ascend", anchor.q, anchor.r, 0)),
    ),
  });

  const primed: number[] = [];
  const crowned: number[] = [];
  for (const [index, type] of NOT_PLANETS.entries()) {
    const anchor = ANCHORS[index] as Hex;
    primed.push(await spawnMote(h, anchor, "mercury"));
    crowned.push(await spawnMote(h, neighbor(anchor, 0), type));
  }
  const controlAnchor = ANCHORS[NOT_PLANETS.length] as Hex;
  const controlMercury = await spawnMote(h, controlAnchor, "mercury");
  await spawnMote(h, neighbor(controlAnchor, 0), "saturn");

  await advanceCycles(h, 1);
  await captureStill(h, "wrong-crown");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "nothing on the field moves, so the cycle reaches its boundary",
  );
  assertEqual(
    moteAt(after, neighbor(controlAnchor, 0))?.type,
    "jupiter",
    "the control's saturn rose a rung, so ascend really did act at this boundary",
  );
  assertNull(
    moteById(after, controlMercury),
    "and the control's mercury was spent doing it",
  );

  for (const [index, type] of NOT_PLANETS.entries()) {
    const anchor = ANCHORS[index] as Hex;
    const mercury = moteById(after, primed[index] as number);
    assertNotNull(
      mercury,
      `the mercury on the prime is unspent, for the ${type} crown`,
    );
    assertEqual(
      mercury?.type,
      "mercury",
      `and it is still mercury, for the ${type} crown`,
    );
    assertEqual(
      `${mercury?.q},${mercury?.r}`,
      `${anchor.q},${anchor.r}`,
      `still resting on the prime hex, for the ${type} crown`,
    );
    assertEqual(
      moteById(after, crowned[index] as number)?.type,
      type,
      `a crown holding ${type} is not a planet, so nothing on it rises`,
    );
    assertNotNull(
      moteAt(after, anchor),
      `and the prime hex is still occupied, for the ${type} crown`,
    );
  }
});
