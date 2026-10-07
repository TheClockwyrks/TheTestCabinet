// sigils/rise-waits-on-fixture — a fixture makes a footprint hex not vacant.
//
// THE RULE. "When every footprint hex is VACANT, the reagent appears"
// (`specs/sigils.md`, Rises and sets), and that file's terms fix the word for
// every sigil at once: "vacant: the hex holds neither a mote nor a FIXTURE". So a
// wheel's fixture standing on one footprint hex blocks the delivery exactly as a
// loose mote does, and "A sigil whose condition does not hold at a boundary waits".
//
// THE CONFIGURATION. A rise whose reagent is two motes, and a `wheel` anchored one
// hex east of the second footprint hex. "A `wheel` is a hub on its anchor hex
// carrying six fixture motes, one on each adjacent hex" (`specs/parts.md`), so one
// fixture lands on that footprint hex and the other five stand clear of both. The
// wheel's tape is empty, "which every part rests on"
// (`specs/instrumentation.md`), so the ring stands still and the fixture is where
// it was raised for the whole cycle.
//
// THE VERDICT, IN BOTH DIRECTIONS. At the blocked boundary the field holds the six
// fixtures and nothing else — read as a length, so a partial delivery fails here —
// and the free footprint hex is bare. Then the ring alone is taken off the field
// with `removeMote`, "the faculty gate `specs/instrumentation.md` names for a
// wheel's fixtures", and one further boundary runs: both motes of the reagent
// arrive.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, place, type Hex } from "../field";
import { challenge } from "../formats";
import { ONE_DUST, ORIGIN, TWO_LUNA } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  clearFixtures,
  createHarness,
  moteAt,
  openBareRun,
  placePart,
  placeRise,
  type Harness,
} from "../harness";

/** A challenge whose one reagent is two `luna` joined east. */
const TWIN_RISE = challenge({
  name: "Twin Rise",
  reagents: [TWO_LUNA],
  products: [ONE_DUST],
  permitted: ["arm"],
});

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spawns nothing while a wheel's fixture rests on one footprint hex", async () => {
  await openBareRun(h, { challenge: TWIN_RISE });
  await placeRise(h, 0, ORIGIN, 0);

  const footprint = TWO_LUNA.motes.map((entry) =>
    place(at(entry.q, entry.r), ORIGIN, 0),
  );
  const free = footprint[0] as Hex;
  const taken = footprint[1] as Hex;

  const wheel = await placePart(h, "wheel", at(taken.q + 1, taken.r), 0);
  const posed = await h.snapshot();
  const fixture = moteAt(posed, taken);
  assertNotNull(
    fixture,
    "a wheel placed into a live run puts a fixture on each of its six spoke hexes",
  );
  assertEqual(
    fixture?.wheel,
    wheel,
    "the mote on the footprint hex is that wheel's fixture rather than a loose mote",
  );
  assertNull(
    moteAt(posed, free),
    "the wheel's other five fixtures stand clear of the rest of the footprint",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "fixture");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a wheel resting on its blank tape faults at nothing, and the rise waits",
  );
  assertEqual(
    moteAt(after, taken)?.wheel,
    wheel,
    "the fixture is still resting on the footprint hex",
  );
  assertNull(
    moteAt(after, free),
    "the free footprint hex is still bare: no part of the reagent arrived",
  );
  assertLength(
    after.sim?.motes ?? [],
    6,
    "the wheel's six fixtures are the whole of the field: the rise spawned nothing",
  );

  // The ring alone is taken off, and the same rise delivers.
  await clearFixtures(h, wheel);
  await advanceCycles(h, 1);

  const delivered = await h.snapshot();
  assertLength(
    delivered.sim?.motes ?? [],
    TWO_LUNA.motes.length,
    "both motes of the reagent arrive once no fixture stands on the footprint",
  );
  for (const [index, hex] of footprint.entries()) {
    assertNotNull(
      moteAt(delivered, hex),
      `the reagent's mote ${index} rests on its pattern hex`,
    );
  }
});
