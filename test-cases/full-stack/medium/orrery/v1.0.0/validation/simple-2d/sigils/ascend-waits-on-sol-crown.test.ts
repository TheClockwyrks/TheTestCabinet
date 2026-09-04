// sigils/ascend-waits-on-sol-crown — a `sol` on the crown is already the top
// rung, so nothing rises and the `mercury` on the prime is left unspent.
//
// THE RULE. "When the prime holds an unbonded, unheld `mercury` and the crown
// holds a planet BELOW `sol`, the `mercury` is consumed and the planet rises one
// rung of `PLANETS`" (`specs/sigils.md`, Transmuting sigils). `specs/field.md`
// fixes where `sol` stands: "`PLANETS` holds the ladder `saturn`, `jupiter`,
// `mars`, `venus`, `luna`, `sol` in that order; ascending a planet moves it one
// rung toward `sol`, which is the top rung", and the roster calls `sol` "the
// sixth and final rung". `sol` is a planet but not one below `sol`, so the crown
// condition fails, "a sigil whose condition does not hold at a boundary waits",
// and a waiting sigil has no partial effect to give: the `mercury` is consumed
// only as part of raising a planet.
//
// THE CONFIGURATION. An `ascend` anchored at `(0, 0)` at rotation `0`, so its
// prime is `(0, 0)` and its crown is `(1, 0)`. A loose, unbonded, unheld
// `mercury` on the prime and a `sol` on the crown. Every part of the condition
// but the crown's rung is satisfied, so the rung is the only thing under test.
//
// AND ONE CONTROL, so a build whose sigil phase does nothing cannot pass. A
// second `ascend`, well clear of the first, with a `mercury` on its prime and a
// `saturn` on its crown, which the same boundary must raise. It decides nothing
// about the `sol` case; it is read back only to say that `ascend` acted at this
// boundary at all.
//
// THE VERDICT. After one cycle the crown is still `sol`, the `mercury` is still
// resting on the prime, and the control's crown is `jupiter` with its `mercury`
// spent.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at, neighbor } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
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

/** The ascend under test: its prime and the crown east of it. */
const PRIME = ORIGIN;
const CROWN = neighbor(ORIGIN, 0);

/** The control ascend, clear of the first footprint. */
const CONTROL_PRIME = at(-4, 2);
const CONTROL_CROWN = neighbor(CONTROL_PRIME, 0);

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises no sol and spends no mercury on a crown already at the top rung", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      sigilPart("ascend", PRIME.q, PRIME.r, 0),
      sigilPart("ascend", CONTROL_PRIME.q, CONTROL_PRIME.r, 0),
    ]),
  });

  const mercury = await spawnMote(h, PRIME, "mercury");
  const crown = await spawnMote(h, CROWN, "sol");
  const controlMercury = await spawnMote(h, CONTROL_PRIME, "mercury");
  await spawnMote(h, CONTROL_CROWN, "saturn");

  await advanceCycles(h, 1);
  await captureStill(h, "sol-crown");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "nothing on the field moves, so the cycle reaches its boundary",
  );
  assertEqual(
    moteAt(after, CONTROL_CROWN)?.type,
    "jupiter",
    "the control's saturn rose a rung, so ascend really did act at this boundary",
  );
  assertNull(
    moteById(after, controlMercury),
    "and the control's mercury was spent doing it",
  );

  assertEqual(
    moteById(after, crown)?.type,
    "sol",
    "sol is the top rung of PLANETS, so it does not rise",
  );
  const stayed = moteById(after, mercury);
  assertNotNull(stayed, "and the mercury on the prime is not consumed");
  assertEqual(stayed?.type, "mercury", "it is still mercury");
  assertEqual(
    `${stayed?.q},${stayed?.r}`,
    `${PRIME.q},${PRIME.r}`,
    "still resting on the prime hex",
  );
});
