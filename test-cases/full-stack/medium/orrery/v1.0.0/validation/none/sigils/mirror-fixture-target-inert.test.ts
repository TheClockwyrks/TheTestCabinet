// sigils/mirror-fixture-target-inert — a wheel's `dust` fixture on a `mirror`'s
// TARGET satisfies nothing, so an essence on the source leaves it as it is.
//
// THE RULE. "A fixture satisfies one condition only, the `mirror` source below"
// (`specs/sigils.md`, Terms). The source is the one place a fixture counts; every
// other reading a sigil makes of a hex — the mirror's target included — is a
// reading a fixture does not answer. So with the source condition satisfied and
// the target holding a `dust` FIXTURE, "the target holds `dust`" is not met and
// "a sigil whose condition does not hold at a boundary waits".
//
// WHICH FIXTURE. `specs/parts.md`'s ring gives spoke `4` a `dust` at rotation
// `0`, and "the fixture on spoke `d` is the entry above for `d - rotation` modulo
// `6`". Spoke `4` is `DIRS[4]`, the hex northwest of the hub — so a wheel at
// `(0, 0)` carries a `dust` fixture on `(0, -1)`.
//
// THE CONFIGURATION. A wheel at `(0, 0)` at rotation `0`. A `mirror` anchored at
// `(0, 0)` at rotation `4`, which puts its source on `(0, 0)` — the hub's own
// hex, which holds no mote, and which `specs/parts.md` expressly allows: "an arm
// or wheel's anchor may sit on any sigil footprint hex". Rotating the footprint
// carries the target from `(1, 0)` onto `DIRS[4]`, the `dust` fixture's hex. A
// loose `nova` rests on the source. The wheel's tape is empty, so its ring stands
// still.
//
// AND ONE CONTROL, so a build whose sigil phase does nothing cannot pass. A
// second `mirror` well away from the wheel, with `nebula` on its source and a
// LOOSE `dust` on its target, which the same boundary must copy onto. It decides
// nothing about the fixture; it is read back only to say that `mirror` acted at
// this boundary at all.
//
// THE VERDICT. After one cycle the fixture on the target is still `dust` and
// still its wheel's, the `nova` on the source is untouched, and the control's
// loose target is `nebula`.

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

/** The mirror is anchored on the hub, rotated so its target lands on spoke 4. */
const MIRROR_ROTATION = 4;

/** Where that rotation puts the source and the target. */
const SOURCE = sigilRoleHex("mirror", "source", ORIGIN, MIRROR_ROTATION) as Hex;
const TARGET = sigilRoleHex("mirror", "target", ORIGIN, MIRROR_ROTATION) as Hex;

/** The type `specs/parts.md` puts on spoke 4 of a wheel at rotation 0. */
const FIXTURE_TYPE = wheelFixture(0, 4);

/** The control mirror, clear of the wheel's ring and of the other footprint. */
const CONTROL = at(-4, 2);
const CONTROL_TARGET = sigilRoleHex("mirror", "target", CONTROL, 0) as Hex;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a dust fixture on the target as it is, while a loose dust target takes the copy", async () => {
  await openBareRun(h, { challenge: BARE });
  const wheel = await placePart(h, "wheel", ORIGIN, 0);
  await placePart(h, "mirror", ORIGIN, MIRROR_ROTATION);
  await placePart(h, "mirror", CONTROL, 0);

  const source = await spawnMote(h, SOURCE, "nova");
  await spawnMote(h, CONTROL, "nebula");
  await spawnMote(h, CONTROL_TARGET, "dust");

  const before = await h.snapshot();

  await advanceCycles(h, 1);
  await captureStill(h, "fixture-target");

  const fixture = moteAt(before, TARGET);
  assertNotNull(fixture, "the wheel raised a fixture onto the target hex");
  assertEqual(fixture?.wheel, wheel, "and it is that wheel's fixture");
  assertEqual(
    fixture?.type,
    FIXTURE_TYPE,
    "carrying the dust WHEEL_MOTES puts on spoke 4",
  );
  assertEqual(
    moteById(before, source)?.type,
    "nova",
    "and the source holds an essence, so the source half of the condition is met",
  );

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "the wheel rests on its blank tape, so the cycle reaches its boundary",
  );
  assertEqual(
    moteAt(after, CONTROL_TARGET)?.type,
    "nebula",
    "the control's LOOSE dust target took its source's essence, so mirror really did act at this boundary",
  );

  const stillFixture = moteAt(after, TARGET);
  assertNotNull(stillFixture, "the fixture is still on the target hex");
  assertEqual(
    stillFixture?.wheel,
    wheel,
    "still carried by its wheel rather than turned loose",
  );
  assertEqual(
    stillFixture?.type,
    FIXTURE_TYPE,
    "and still dust: a fixture satisfies no condition but the mirror source",
  );
  assertEqual(
    moteById(after, source)?.type,
    "nova",
    "while the essence on the source is itself untouched",
  );
});
