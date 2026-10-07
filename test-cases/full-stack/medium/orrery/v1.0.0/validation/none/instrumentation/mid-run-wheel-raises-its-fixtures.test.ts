// instrumentation/mid-run-wheel-raises-its-fixtures — a wheel placed during a live
// run enters with its six fixtures on its spoke hexes.
//
// THE RULE. Of the whole machine group, "While a run is live, a part one of them
// adds enters the run at its rest pose holding nothing, with a wheel's six
// fixtures on its spoke hexes" (`specs/instrumentation.md`, The machine) — the
// same six a run raises at its start, "every wheel's six fixtures appear on its
// spoke hexes" (`specs/simulation.md`, The run). Which fixture sits on which spoke
// is `specs/parts.md`'s: "A `wheel` is a hub on its anchor hex carrying six
// fixture motes, one on each adjacent hex. `WHEEL_MOTES` holds the ring at
// rotation `0`, by spoke", `nebula`, `comet`, `nova`, `meteor`, `dust`, `dust` —
// and "The wheel's rotation turns the whole ring, so the fixture on spoke `d` is
// the entry above for `d - rotation` modulo `6`." A fixture is reported as a mote
// carrying its wheel: "`wheel: <number | null>`" (`specs/instrumentation.md`,
// Snapshot shape).
//
// THE CONFIGURATION. A live run on an empty machine and an EMPTY FIELD —
// `clearMotes` "Removes every mote, fixtures included" — and then one wheel placed
// on `(0, 0)` at rotation `2`. The rotation is not `0` on purpose: at rotation `2`
// every spoke carries a different fixture from the one `WHEEL_MOTES` lists it
// under, so a build that ignored the rotation reports the wrong ring. Nothing else
// is placed and nothing else is on the field, so every mote the run reports is one
// this wheel raised.
//
// THE VERDICT. The run reports exactly six motes, all six carrying this wheel,
// one on each of the wheel's six adjacent hexes, each of the type
// `WHEEL_MOTES[d - 2 mod 6]` names for its spoke. No loose mote is on the field.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { at } from "../field";
import { wheelFixture, wheelFixtureHexes } from "../parts";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  fixturesOf,
  looseMotes,
  moteAt,
  openBareRun,
  placePart,
  type Harness,
} from "../harness";

/** The rotation the wheel is placed at: not 0, so the ring has to turn with it. */
const ROTATION = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the six fixtures of a wheel added mid-run, in its rotation's arrangement", async () => {
  await openBareRun(h, { challenge: BARE });
  const anchor = at(0, 0);
  const bare = await h.snapshot();

  const wheel = await placePart(h, "wheel", anchor, ROTATION);
  await h.advance(1);
  await captureStill(h, "fixtures");
  const raised = await h.snapshot();

  assertLength(
    bare.sim?.motes ?? [],
    0,
    "the field is empty before the wheel is placed, so every mote after it is the wheel's",
  );
  assertLength(
    fixturesOf(raised, wheel),
    6,
    "the wheel enters the run carrying six fixtures",
  );
  assertLength(
    looseMotes(raised),
    0,
    "the wheel raises fixtures alone: nothing loose is on the field",
  );

  for (const [spoke, hex] of wheelFixtureHexes(anchor).entries()) {
    const fixture = moteAt(raised, hex);
    assertNotNull(
      fixture,
      `spoke ${spoke}: a fixture rests on the wheel's hex at (${hex.q}, ${hex.r})`,
    );
    assertEqual(
      fixture?.wheel,
      wheel,
      `spoke ${spoke}: the mote on that hex belongs to the wheel that raised it`,
    );
    assertEqual(
      fixture?.type,
      wheelFixture(ROTATION, spoke),
      `spoke ${spoke}: the fixture is the WHEEL_MOTES entry for spoke ${spoke} - ${ROTATION}`,
    );
  }
});
