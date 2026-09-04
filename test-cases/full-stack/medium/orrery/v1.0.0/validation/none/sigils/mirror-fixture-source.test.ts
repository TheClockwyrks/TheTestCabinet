// sigils/mirror-fixture-source — a wheel's essence fixture on a `mirror`'s source
// hex satisfies the source condition exactly as a loose essence does.
//
// THE RULE, which is the one exception the sigil file makes for fixtures. "A
// fixture satisfies one condition only, the `mirror` source below"
// (`specs/sigils.md`, Terms), and the sigil's own entry says it again: "when the
// source holds an essence and the target holds `dust`, the target becomes that
// essence. A wheel's essence fixture on the source hex satisfies the source
// condition exactly as a loose essence does."
//
// WHICH FIXTURE. `specs/parts.md` fixes the zodiac wheel's ring: "a `wheel` is a
// hub on its anchor hex carrying six fixture motes, one on each adjacent hex",
// with `WHEEL_MOTES` giving spoke `0` a `nebula`, and "the fixture on spoke `d`
// is the entry above for `d - rotation` modulo `6`". At rotation `0`, spoke `0`
// is the hex east of the hub and it carries an essence — which is what makes it
// usable as a source at all.
//
// THE CONFIGURATION. A wheel at `(0, 0)` at rotation `0`, so its `nebula` fixture
// rests on `(1, 0)`. A `mirror` anchored at `(1, 0)` at rotation `0`, so its
// source is that same hex and its target is `(2, 0)`, which the ring does not
// reach. One loose `dust` on the target. The wheel's tape is empty, so it rests
// and its ring stands still: "a blank cell is a rest on every part, a wheel
// included, and never faults" (`specs/simulation.md`).
//
// WHY THE WHEEL IS PLACED AFTER THE RUN OPENS. `clearMotes` "removes every mote,
// fixtures included", so a wheel loaded before `startRun` would have no ring left
// by the time the field was emptied. A part placed into a LIVE run "enters the
// run at its rest pose holding nothing, with a wheel's six fixtures on its spoke
// hexes" (`specs/instrumentation.md`), which is the ring this check needs.
//
// THE VERDICT. After one cycle the loose `dust` on the target is `nebula`: the
// fixture sourced the copy. The fixture itself is still a fixture of that wheel,
// still `nebula`, still resting on the source hex.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { at, type Hex } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import { sigilRoleHex, wheelFixture } from "../parts";
import {
  advanceCycles,
  captureStill,
  createHarness,
  moteAt,
  moteById,
  openBareRun,
  placePart,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

/** The wheel's spoke-0 hex at rotation 0: the hex east of the hub. */
const FIXTURE_HEX = at(1, 0);

/** The essence `specs/parts.md` puts on that spoke. */
const FIXTURE_TYPE = wheelFixture(0, 0);

/** The mirror is anchored on the fixture's hex, so its source is that hex. */
const TARGET = sigilRoleHex("mirror", "target", FIXTURE_HEX, 0) as Hex;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("copies a wheel's essence fixture onto the dust on the mirror's target", async () => {
  await openBareRun(h, { challenge: BARE });
  const wheel = await placePart(h, "wheel", ORIGIN, 0);
  await placePart(h, "mirror", FIXTURE_HEX, 0);
  const target = await spawnMote(h, TARGET, "dust");

  const before = await h.snapshot();

  await advanceCycles(h, 1);
  await captureStill(h, "fixture-source");

  const fixture = moteAt(before, FIXTURE_HEX);
  assertNotNull(fixture, "the wheel raised a fixture onto the source hex");
  assertEqual(
    fixture?.wheel,
    wheel,
    "and it is that wheel's fixture rather than a loose mote",
  );
  assertEqual(
    fixture?.type,
    FIXTURE_TYPE,
    "which at rotation 0 on spoke 0 is an essence, as WHEEL_MOTES fixes",
  );
  assertEqual(
    moteById(before, target)?.type,
    "dust",
    "and the target beside it starts holding dust",
  );

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "the wheel rests on its blank tape, so the cycle reaches its boundary",
  );
  const copy = moteAt(after, TARGET);
  assertNotNull(copy, "a mote is still resting on the target hex");
  assertEqual(
    copy?.type,
    FIXTURE_TYPE,
    "the target became the fixture's essence: a fixture satisfies the mirror source",
  );

  const stillFixture = moteAt(after, FIXTURE_HEX);
  assertNotNull(stillFixture, "the fixture is still on the source hex");
  assertEqual(
    stillFixture?.wheel,
    wheel,
    "still carried by its wheel: a mirror copies its source rather than spending it",
  );
  assertEqual(
    stillFixture?.type,
    FIXTURE_TYPE,
    "and still holding the essence it was raised with",
  );
});
