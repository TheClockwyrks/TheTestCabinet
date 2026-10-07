// parts/wheel-fixture-roster — a wheel's ring holds the six types `WHEEL_MOTES`
// names, one per spoke.
//
// THE RULE. "A `wheel` is a hub on its anchor hex carrying six fixture motes, one
// on each adjacent hex. `WHEEL_MOTES` holds the ring at rotation `0`, by spoke"
// (`specs/parts.md`, The zodiac wheel), and the table is: spoke `0` `nebula`,
// spoke `1` `comet`, spoke `2` `nova`, spoke `3` `meteor`, spoke `4` `dust`,
// spoke `5` `dust`. A fixture is a mote of the field: "A fixture is one of the six
// motes a zodiac wheel carries, defined in `specs/parts.md`" (`specs/field.md`),
// and `sim.motes` reports one with `wheel` naming the wheel it belongs to, where
// "`wheel`: `<number | null>`" is "`null` on every real mote"
// (`specs/instrumentation.md`).
//
// HOW THE RING IS RAISED. "Every arm and wheel takes its rest pose ... and every
// wheel's six fixtures appear on its spoke hexes" (`specs/simulation.md`, The
// run), and the same holds for a wheel that arrives after the start: "While a run
// is live, a part one of them adds enters the run at its rest pose holding
// nothing, with a wheel's six fixtures on its spoke hexes"
// (`specs/instrumentation.md`). So the bare opener empties the field first —
// `clearMotes` "removes every mote, fixtures included" — and the wheel is then
// placed into the live run, which makes its six fixtures the whole of the world.
//
// THE CONFIGURATION. One `wheel` at `(0, 0)` at rotation `0`, the rotation the
// `WHEEL_MOTES` table is written at, with an empty tape so the ring stands still.
// Nothing else is on the field.
//
// THE VERDICT. Six fixtures, all belonging to that wheel, one resting on each of
// the six hexes adjacent to the anchor, and each of the six is the type
// `WHEEL_MOTES` names for its spoke. No loose mote is on the field, so the ring is
// exactly what was read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { WHEEL_MOTES } from "../constants";
import { BARE, ORIGIN } from "../fixtures";
import { wheelFixtureHexes } from "../parts";
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises a nebula, comet, nova, meteor and two dust on spokes 0 to 5", async () => {
  assertLength(
    WHEEL_MOTES,
    6,
    "WHEEL_MOTES holds the ring at rotation 0, one entry per spoke",
  );

  await openBareRun(h, { challenge: BARE });
  const wheel = await placePart(h, "wheel", ORIGIN, 0);

  await h.advance(1);
  const snapshot = await h.snapshot();
  await captureStill(h, "roster");

  assertNotNull(snapshot.sim, "the run is live with the wheel on the field");
  assertEqual(
    poseOf(snapshot, wheel)?.rotation,
    0,
    "the wheel stands at rotation 0, the rotation the WHEEL_MOTES table is written at",
  );
  assertLength(
    fixturesOf(snapshot, wheel),
    6,
    "a wheel carries six fixture motes, one on each adjacent hex",
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
      `spoke ${d}: the mote on (${hex.q}, ${hex.r}) is that wheel's fixture rather than a loose mote`,
    );
    assertEqual(
      fixture?.type,
      WHEEL_MOTES[d],
      `spoke ${d} carries the WHEEL_MOTES entry for it`,
    );
  }
});
