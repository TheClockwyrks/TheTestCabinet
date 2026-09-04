// sigils/ascend-consumes-mercury — the `mercury` that raised the planet is spent:
// it is off the field afterwards.
//
// THE RULE. "When the prime holds an unbonded, unheld `mercury` and the crown
// holds a planet below `sol`, the `mercury` is consumed and the planet rises one
// rung of `PLANETS`" (`specs/sigils.md`, Transmuting sigils). `specs/field.md`
// gives `mercury` its part: "spent to raise a planet one rung". Consumed is not a
// change of type or a move: the mote is gone, so the run reports no mote under
// that id and the prime hex holds nothing.
//
// THE CONFIGURATION. One `ascend` anchored at `(0, 0)` at rotation `0`, so its
// prime is `(0, 0)` and its crown is `(1, 0)`. A loose, unbonded, unheld
// `mercury` on the prime and a `saturn` — the first rung of the ladder, well
// below `sol` — on the crown. Nothing else is on the field, and nothing on it
// moves: the one part is a sigil, and a sigil carries no tape.
//
// THE VERDICT, in two halves that need each other. The crown is `jupiter`, so
// this was the boundary that raised a planet rather than one that did nothing;
// and the `mercury` is gone — no mote under its id, no mote on the prime hex, and
// the risen planet alone left on the field.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import { neighbor } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  looseMotes,
  moteAt,
  moteById,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

/** The ascend's prime hex, and the crown east of it at rotation 0. */
const PRIME = ORIGIN;
const CROWN = neighbor(ORIGIN, 0);

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the mercury off the field at the boundary that raised the planet", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("ascend", PRIME.q, PRIME.r, 0)]),
  });

  const mercury = await spawnMote(h, PRIME, "mercury");
  await spawnMote(h, CROWN, "saturn");

  await advanceCycles(h, 1);
  await captureStill(h, "spent");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "nothing on the field moves, so the cycle reaches its boundary",
  );
  assertEqual(
    moteAt(after, CROWN)?.type,
    "jupiter",
    "the crown's saturn rose a rung, so this is the boundary that spent the mercury",
  );

  assertNull(
    moteById(after, mercury),
    "the mercury that raised it is consumed: the run reports no mote under its id",
  );
  assertNull(
    moteAt(after, PRIME),
    "and the prime hex holds nothing at all afterwards",
  );
  assertLength(
    looseMotes(after),
    1,
    "so the risen planet is the only mote left on the field",
  );
});
