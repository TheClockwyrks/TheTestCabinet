// parts/fixture-ring-off-the-field-is-legal — a wheel anchored on the field may
// carry fixtures past the boundary, and they rest there.
//
// THE RULE. Placement rule 1 names a WHEEL'S ANCHOR and nothing else of a wheel:
// "Every hex of the part is on the field: an arm or wheel's anchor, every cell of
// a track, and every footprint hex of a sigil, rise, or set" (`specs/parts.md`,
// Placement rules). The ring is not on that list. What the ring is:
// "A `wheel` is a hub on its anchor hex carrying six fixture motes, one on each
// adjacent hex" (`specs/parts.md`, The zodiac wheel). Where they end up at the
// start of a run: "Every arm and wheel takes its rest pose, holding nothing, and
// every wheel's six fixtures appear on its spoke hexes" (`specs/simulation.md`,
// The run), which `specs/instrumentation.md` repeats for a wheel added while a
// run is live: "a part one of them adds enters the run at its rest pose holding
// nothing, with a wheel's six fixtures on its spoke hexes". A mote is free to
// stand off the field: "A mote may be carried over, dropped on, and rest on a hex
// off the field" (`specs/simulation.md`).
//
// THE CONFIGURATION. A bare run on a posed challenge with an empty field, so the
// only motes in it are the ones the wheel raises. One `wheel` is placed on
// `(5, 0)`, the field's east boundary. Three of its six adjacent hexes —
// `(6, 0)`, `(5, 1)` and `(6, -1)` — have `max(|q|, |r|, |q + r|)` of `6` and so
// lie outside a field of radius `5`.
//
// THE VERDICT. The placement is taken, the wheel stands on `(5, 0)`, and all six
// fixtures are on the field's motes — the three off-field ones resting on their
// own ring hexes like the three on-field ones.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { FIELD_R } from "../constants";
import { at, onField, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  fixturesOf,
  moteAt,
  openBareRun,
  partById,
  partIds,
  placePart,
  type Harness,
} from "../harness";
import { wheelFixtureHexes } from "../parts";

/**
 * Whether the surface REFUSED a placement: "Each placement is checked against
 * the placement rules of `specs/parts.md` alone, and throws an `Error` naming
 * the first rule it breaks" (`specs/instrumentation.md`, The machine).
 */
async function refusesPlacement(place: () => Promise<unknown>): Promise<boolean> {
  try {
    await place();
    return false;
  } catch {
    return true;
  }
}

/** The anchor: the field's east boundary hex. */
const ANCHOR: Hex = at(FIELD_R, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places a wheel at the field's edge and rests its outside fixtures off the field", async () => {
  await openBareRun(h, { challenge: BARE });

  // The geometry the check claims to be posing: an anchor on the field, three of
  // whose six adjacent hexes are not.
  assertEqual(onField(ANCHOR), true, "the wheel's anchor is on the field");
  const ring = wheelFixtureHexes(ANCHOR);
  assertEqual(ring.length, 6, "a wheel's ring is its anchor's six adjacent hexes");
  const beyond = ring.filter((hex) => !onField(hex));
  assertEqual(beyond.length, 3, "three of those six hexes lie outside the field");

  let wheel = -1;
  const refused = await refusesPlacement(async () => {
    wheel = await placePart(h, "wheel", ANCHOR, 0);
  });

  await h.advance(1);
  await captureStill(h, "edge-wheel");

  assertEqual(
    refused,
    false,
    `a wheel anchored on (${ANCHOR.q}, ${ANCHOR.r}) is placed: rule 1 names its anchor alone`,
  );
  const snapshot = await h.snapshot();
  assertEqual(partById(snapshot, wheel)?.kind, "wheel", "the wheel stands on the machine");
  assertEqual(
    `${partById(snapshot, wheel)?.q},${partById(snapshot, wheel)?.r}`,
    `${ANCHOR.q},${ANCHOR.r}`,
    "the wheel is anchored on the field's boundary hex",
  );
  assertEqual((await partIds(h)).length, 1, "the wheel is the whole machine");

  assertEqual(
    fixturesOf(snapshot, wheel).length,
    6,
    "the wheel carries its six fixtures, the ones off the field included",
  );
  for (const hex of ring) {
    const fixture = moteAt(snapshot, hex);
    assertNotNull(
      fixture,
      `a fixture rests on the ring hex (${hex.q}, ${hex.r})`,
    );
    assertEqual(
      fixture?.wheel,
      wheel,
      `the mote on (${hex.q}, ${hex.r}) is this wheel's fixture`,
    );
  }
  assertEqual(
    snapshot.sim?.motes.length,
    6,
    "the six fixtures are the whole of the field: nothing else was raised",
  );
});
