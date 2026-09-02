// sigils/ascend-luna-reaches-sol — a `luna` on the crown rises to `sol`, the top
// rung of the ladder.
//
// THE RULE. `ascend`'s table gives its two hexes, `(0, 0)` prime and `(1, 0)`
// crown, and its sentence fixes the effect: "When the prime holds an unbonded,
// unheld `mercury` and the crown holds a planet below `sol`, the `mercury` is
// consumed and the planet rises one rung of `PLANETS`" (`specs/sigils.md`).
// `PLANETS` is the ladder `specs/field.md` writes down — "`saturn`, `jupiter`,
// `mars`, `venus`, `luna`, `sol` in that order; ascending a planet moves it one
// rung toward `sol`, which is the top rung" — so the rung above `luna` is `sol`.
// This is the one ascension that lands ON the top of the ladder rather than
// somewhere inside it, and `luna` is a planet below `sol`, so the condition
// holds for it exactly as it does for the rungs beneath.
//
// THE CONFIGURATION. One `ascend` anchored on the middle of the field at
// rotation `0`, so its prime is `(0, 0)` and its crown `(1, 0)`. A `mercury`
// rests on the prime and a `luna` on the crown, both spawned by `spawnMote`,
// which "adds one unbonded, unheld mote" — the two conditions the prime's
// `mercury` must satisfy. The two motes are the whole of the field: the opener
// clears it, and nothing else is placed, so nothing else can act on either.
//
// THE VERDICT, read at the boundary of one cycle, where "sigils act in four
// waves" (`specs/simulation.md`, The sigil phase). The crown holds `sol`, the
// prime is empty because the `mercury` was consumed, and one mote is left on the
// field. The rung is computed from `PLANETS` rather than written down, so what
// the check compares is the specification's ladder against the build's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { PLANETS } from "../constants";
import { at, place } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  looseMotes,
  moteAt,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the crown's luna to sol and spends the mercury", async () => {
  const anchor = ORIGIN;
  const rotation = 0;
  const prime = place(at(0, 0), anchor, rotation);
  const crown = place(at(1, 0), anchor, rotation);

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("ascend", anchor.q, anchor.r, rotation)]),
  });
  const mercury = await spawnMote(h, prime, "mercury");
  const planet = await spawnMote(h, crown, "luna");

  const posed = await h.snapshot();
  assertEqual(
    moteAt(posed, prime)?.id,
    mercury,
    "the mercury is posed on the ascend's prime hex",
  );
  assertEqual(
    moteAt(posed, crown)?.id,
    planet,
    "the luna is posed on the ascend's crown hex",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "luna-sol");

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is still live at the boundary");
  assertEqual(
    after.sim?.status,
    "running",
    "an ascension is not a fault: the cycle reached its boundary",
  );
  // The rung above luna, read off the ladder specs/field.md fixes rather than
  // written down here, so a build climbing a different ladder is what fails.
  const risen = PLANETS[PLANETS.indexOf("luna") + 1];
  assertNotNull(
    moteAt(after, crown),
    "the crown still holds the planet the ascension raised",
  );
  assertEqual(
    moteAt(after, crown)?.type,
    risen,
    "luna is the fifth rung, so it rises to sol, the sixth and final one",
  );
  assertNull(
    moteAt(after, prime),
    "the mercury on the prime was consumed, leaving the hex empty",
  );
  assertEqual(
    looseMotes(after).length,
    1,
    "two motes went in and the risen planet alone is left on the field",
  );
});
