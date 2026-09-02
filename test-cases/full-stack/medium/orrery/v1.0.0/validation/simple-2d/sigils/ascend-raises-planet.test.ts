// sigils/ascend-raises-planet — the planet on an `ascend`'s crown rises exactly
// one rung of `PLANETS`.
//
// THE RULE. `ascend`'s footprint is `(0, 0)` prime and `(1, 0)` crown, and "when
// the prime holds an unbonded, unheld `mercury` and the crown holds a planet
// below `sol`, the `mercury` is consumed and the planet rises one rung of
// `PLANETS`" (`specs/sigils.md`, Transmuting sigils). The ladder is
// `specs/field.md`'s: "`PLANETS` holds the ladder `saturn`, `jupiter`, `mars`,
// `venus`, `luna`, `sol` in that order; ascending a planet moves it one rung
// toward `sol`, which is the top rung." One rung, so `saturn` answers `jupiter`
// and not `mars`, and the ladder's order is what fixes each answer.
//
// THE FOUR RUNGS. `saturn` to `jupiter`, `jupiter` to `mars`, `mars` to `venus`,
// and `venus` to `luna` — every rung below `sol` but `luna`, whose rise to the
// top rung is its own review item. They are read out of `PLANETS` here rather
// than written down, so the pairs a build is measured against are the ladder the
// specification fixed.
//
// THE CONFIGURATION. Four `ascend` sigils, two rows apart so no footprint of one
// touches another, anchored at `(-2, -3)`, `(-2, -1)`, `(-2, 1)` and `(-2, 3)` at
// rotation `0` — so each prime is its anchor and each crown the hex east of it. A
// loose, unbonded, unheld `mercury` rests on every prime and one planet on every
// crown. Nothing else is on the field, and nothing on it moves: every part is a
// sigil, and a sigil carries no tape.
//
// THE VERDICT. After one cycle a mote is resting on each crown hex carrying the
// rung above the one that crown started on.
//
// THE CROWN IS READ BY ITS HEX, NOT BY A MOTE ID. What the specification fixes is
// what is on the crown afterwards: "the planet rises one rung of `PLANETS`". It
// does not say whether the risen planet is the same mote with a new type or a
// fresh one — and the sigils that DO replace say so in their own words, as
// `conjoin`'s "one mote of the next rung appears on the crown" does. Reading the
// hex decides the requirement without deciding that.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { PLANETS, type MoteName } from "../constants";
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

/**
 * The rungs this item names: every planet below `sol` except `luna`, whose rise
 * to `sol` is a review item of its own. Each is paired with the rung above it.
 */
const RUNGS: readonly { from: MoteName; to: MoteName }[] = PLANETS.slice(
  0,
  PLANETS.length - 2,
).map((from, index) => ({ from, to: PLANETS[index + 1] as MoteName }));

/** One ascend per rung, two rows apart, all comfortably inside the field. */
const PRIMES: readonly Hex[] = RUNGS.map((_, index) => at(-2, -3 + 2 * index));

/** At rotation 0 the crown is the hex east of the prime: `DIRS[0]`. */
const CROWNS: readonly Hex[] = PRIMES.map((prime) => neighbor(prime, 0));

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises saturn, jupiter, mars and venus each one rung of PLANETS", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution(
      PRIMES.map((prime) => sigilPart("ascend", prime.q, prime.r, 0)),
    ),
  });

  const crowned: number[] = [];
  for (const [index, rung] of RUNGS.entries()) {
    await spawnMote(h, PRIMES[index] as Hex, "mercury");
    crowned.push(await spawnMote(h, CROWNS[index] as Hex, rung.from));
  }

  const before = await h.snapshot();

  await advanceCycles(h, 1);
  await captureStill(h, "risen");

  for (const [index, rung] of RUNGS.entries()) {
    assertEqual(
      moteById(before, crowned[index] as number)?.type,
      rung.from,
      `the crown starts holding ${rung.from}, a planet below sol`,
    );
  }

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "nothing on the field moves, so the cycle reaches its boundary",
  );
  assertEqual(after.sim?.cycle, 1, "and the boundary really ran");

  for (const [index, rung] of RUNGS.entries()) {
    const risen = moteAt(after, CROWNS[index] as Hex);
    assertNotNull(
      risen,
      `a mote is still resting on the crown, for ${rung.from}`,
    );
    assertEqual(
      risen?.type,
      rung.to,
      `${rung.from} rises exactly one rung of PLANETS, to ${rung.to}`,
    );
  }
});
