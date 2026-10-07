// sigils/rise-waits-on-occupied-footprint — one occupied hex and nothing arrives.
//
// THE RULE. "When EVERY footprint hex is vacant, the reagent appears"
// (`specs/sigils.md`, Rises and sets), under a file whose terms fix "vacant: the
// hex holds neither a mote nor a fixture" and whose standing rule is "A sigil
// whose condition does not hold at a boundary waits". Waiting is not faulting:
// `FAULTS` names every way a run halts (`specs/simulation.md`) and an occupied
// footprint is not among them.
//
// THE CONFIGURATION. A rise whose reagent is TWO motes, so one of its two
// footprint hexes can be occupied while the other is bare — which is what "even one
// of its footprint hexes" needs to be readable at all. One `dust` rests on the
// second of them; the machine holds nothing else, so nothing can deliver, consume,
// or carry anything.
//
// THE VERDICT, IN BOTH DIRECTIONS. At the blocked boundary the field still holds
// that one `dust` and nothing else, the free footprint hex is still bare, and the
// run is still `running` with `sim.fault` `null`. Then the blocker alone is removed
// and one further boundary runs: both motes of the reagent arrive. Without that
// second reading a build with no rise at all would pass the first.

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
  createHarness,
  moteAt,
  openBareRun,
  placeRise,
  spawnMote,
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

it("spawns nothing and raises no fault while a mote rests on one footprint hex", async () => {
  await openBareRun(h, { challenge: TWIN_RISE });
  await placeRise(h, 0, ORIGIN, 0);

  const footprint = TWO_LUNA.motes.map((entry) =>
    place(at(entry.q, entry.r), ORIGIN, 0),
  );
  const free = footprint[0] as Hex;
  const taken = footprint[1] as Hex;
  const blocker = await spawnMote(h, taken, "dust");

  await advanceCycles(h, 1);
  await captureStill(h, "blocked");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "an occupied footprint is no fault: the rise simply waits",
  );
  assertNull(
    after.sim?.fault ?? null,
    "a rise that waited raises nothing under FAULTS",
  );
  assertEqual(
    moteAt(after, taken)?.id,
    blocker,
    "the mote occupying the footprint hex is untouched",
  );
  assertNull(
    moteAt(after, free),
    "the free footprint hex is still bare: no part of the reagent arrived",
  );
  assertLength(
    after.sim?.motes ?? [],
    1,
    "the blocker is still the whole of the field: the rise spawned nothing",
  );

  // The blocker alone is removed, and the same rise delivers.
  await h.debug.removeMote(blocker);
  await advanceCycles(h, 1);

  const delivered = await h.snapshot();
  assertLength(
    delivered.sim?.motes ?? [],
    TWO_LUNA.motes.length,
    "both motes of the reagent arrive once every footprint hex is vacant",
  );
  for (const [index, hex] of footprint.entries()) {
    assertNotNull(
      moteAt(delivered, hex),
      `the reagent's mote ${index} rests on its pattern hex`,
    );
  }
});
