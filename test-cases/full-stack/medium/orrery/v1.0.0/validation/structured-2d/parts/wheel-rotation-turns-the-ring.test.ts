// parts/wheel-rotation-turns-the-ring — a wheel's rotation turns its whole fixture
// ring with it.
//
// THE RULE. "The wheel's rotation turns the whole ring, so the fixture on spoke
// `d` is the entry above for `d - rotation` modulo `6`" (`specs/parts.md`, The
// zodiac wheel), where "the entry above" is the `WHEEL_MOTES` table at rotation
// `0`: spoke `0` `nebula`, `1` `comet`, `2` `nova`, `3` `meteor`, `4` and `5`
// `dust`. So a wheel at rotation `2` carries `nebula` on spoke `2`, `comet` on
// `3`, `nova` on `4`, `meteor` on `5`, and `dust` on `0` and `1` — the whole ring
// two steps round, not the table read from `0` again.
//
// HOW THE RING IS RAISED. "While a run is live, a part one of them adds enters the
// run at its rest pose holding nothing, with a wheel's six fixtures on its spoke
// hexes" (`specs/instrumentation.md`), and its rest pose is the placed one: "An
// arm's placed rotation and length are its rest pose" (`specs/parts.md`). The bare
// opener empties the field first — `clearMotes` "removes every mote, fixtures
// included" — so the six fixtures are the whole of the world.
//
// THE CONFIGURATION. One `wheel` at `(0, 0)` placed at rotation `2`, with an empty
// tape so nothing turns it further. Rotation `2` is chosen because it moves every
// one of the six entries: no spoke carries the type it would carry at rotation
// `0`, except where the table's two `dust` make that unavoidable.
//
// THE VERDICT. Six fixtures, all that wheel's, one on each adjacent hex, and each
// spoke `d` holds the `WHEEL_MOTES` entry for `d - 2` modulo `6`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { BARE, ORIGIN } from "../fixtures";
import { wheelFixture, wheelFixtureHexes } from "../parts";
import {
  captureStill,
  createHarness,
  fixturesOf,
  looseMotes,
  moteAt,
  openBareRun,
  placePart,
  poseOf,
  type Harness,
} from "../harness";

/** The rotation the ring is read at. */
const ROTATION = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries nebula on spoke 2 and the rest of the ring two steps round with it", async () => {
  assertEqual(
    [0, 1, 2, 3, 4, 5].map((d) => wheelFixture(ROTATION, d)).join(","),
    "dust,dust,nebula,comet,nova,meteor",
    "at rotation 2 the fixture on spoke d is the WHEEL_MOTES entry for d - 2 modulo 6",
  );

  await openBareRun(h, { challenge: BARE });
  const wheel = await placePart(h, "wheel", ORIGIN, ROTATION);

  await h.advance(1);
  const snapshot = await h.snapshot();
  await captureStill(h, "turned");

  assertNotNull(snapshot.sim, "the run is live with the wheel on the field");
  assertEqual(
    poseOf(snapshot, wheel)?.rotation,
    ROTATION,
    "the wheel entered the run at the rotation it was placed at",
  );
  assertLength(
    fixturesOf(snapshot, wheel),
    6,
    "a wheel carries six fixture motes whatever its rotation",
  );
  assertLength(
    looseMotes(snapshot),
    0,
    "nothing but the ring is on the field, so every mote read below is a fixture",
  );

  const hexes = wheelFixtureHexes(ORIGIN);
  for (const d of [0, 1, 2, 3, 4, 5]) {
    const hex = hexes[d] ?? ORIGIN;
    const fixture = moteAt(snapshot, hex);
    assertNotNull(
      fixture,
      `spoke ${d}: a fixture rests on the adjacent hex (${hex.q}, ${hex.r})`,
    );
    assertEqual(
      fixture?.wheel,
      wheel,
      `spoke ${d}: the mote on (${hex.q}, ${hex.r}) is that wheel's fixture`,
    );
    assertEqual(
      fixture?.type,
      wheelFixture(ROTATION, d),
      `spoke ${d} carries the WHEEL_MOTES entry for ${d} - ${ROTATION} modulo 6`,
    );
  }
});
