// sigils/ascend-requires-mercury-prime — an `ascend` whose prime holds anything
// but `mercury` raises nothing on its crown.
//
// THE RULE. "When the prime holds an unbonded, unheld `mercury` and the crown
// holds a planet below `sol`, the `mercury` is consumed and the planet rises one
// rung of `PLANETS`" (`specs/sigils.md`, Transmuting sigils), and "a sigil whose
// condition does not hold at a boundary waits" (`specs/sigils.md`). The prime
// condition names one type out of the fifteen `specs/field.md` rosters, so the
// sweep below is `MOTES` less `mercury`, taken from that roster rather than
// listed by hand.
//
// THE CONFIGURATION. Fourteen `ascend` sigils, one per non-`mercury` type, laid
// out as pairwise disjoint footprints across four rows of the field, each at
// rotation `0` so its prime is its anchor and its crown the hex east of it. Every
// crown holds a `saturn` — the first rung of the ladder, well below `sol` — so
// the crown half of the condition is satisfied in all fourteen and the prime is
// the only thing under test.
//
// AND ONE CONTROL, so a build whose sigil phase does nothing cannot pass. A
// fifteenth `ascend`, with `mercury` on its prime and `saturn` on its crown,
// which the same boundary must raise. It is a sigil of its own on hexes of its
// own and decides nothing about the fourteen; it is read back only to say that
// `ascend` acted at this boundary at all.
//
// THE VERDICT. After one cycle every one of the fourteen crowns is still
// `saturn`, each prime still carries the type it was spawned with — unspent,
// still resting on the prime hex — and the control's crown is `jupiter`.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field, every part
// is a sigil, and a sigil carries no tape — so nothing moves and the only change
// across the boundary is the sigil phase's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { MOTES, type MoteName } from "../constants";
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

/** Every type the prime condition does not name: the roster less `mercury`. */
const NOT_MERCURY: readonly MoteName[] = MOTES.filter(
  (type) => type !== "mercury",
);

/**
 * Fifteen anchors — one per case, plus the control — whose footprints are
 * pairwise disjoint: each takes its anchor and the hex east of it, and the rows
 * are two apart so no two footprints can meet.
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
  at(1, 0),
  at(3, 0),
  at(-5, 2),
  at(-3, 2),
  at(-1, 2),
];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the crown's planet where it is when the prime holds any type but mercury", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution(
      ANCHORS.map((anchor) => sigilPart("ascend", anchor.q, anchor.r, 0)),
    ),
  });

  const primed: number[] = [];
  const crowned: number[] = [];
  for (const [index, type] of NOT_MERCURY.entries()) {
    const anchor = ANCHORS[index] as Hex;
    primed.push(await spawnMote(h, anchor, type));
    crowned.push(await spawnMote(h, neighbor(anchor, 0), "saturn"));
  }
  const controlAnchor = ANCHORS[NOT_MERCURY.length] as Hex;
  await spawnMote(h, controlAnchor, "mercury");
  await spawnMote(h, neighbor(controlAnchor, 0), "saturn");

  await advanceCycles(h, 1);
  await captureStill(h, "wrong-prime");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "nothing on the field moves, so the cycle reaches its boundary",
  );
  assertEqual(
    moteAt(after, neighbor(controlAnchor, 0))?.type,
    "jupiter",
    "the control's saturn rose over a mercury prime, so ascend really did act at this boundary",
  );

  for (const [index, type] of NOT_MERCURY.entries()) {
    const anchor = ANCHORS[index] as Hex;
    assertEqual(
      moteById(after, crowned[index] as number)?.type,
      "saturn",
      `a prime holding ${type} is not mercury, so the crown's planet does not rise`,
    );
    const stayed = moteById(after, primed[index] as number);
    assertNotNull(stayed, `the ${type} on the prime is still a mote`);
    assertEqual(
      stayed?.type,
      type,
      `and it still carries the type it was spawned with, for ${type}`,
    );
    assertEqual(
      `${stayed?.q},${stayed?.r}`,
      `${anchor.q},${anchor.r}`,
      `still resting on the prime hex, for ${type}`,
    );
  }
});
