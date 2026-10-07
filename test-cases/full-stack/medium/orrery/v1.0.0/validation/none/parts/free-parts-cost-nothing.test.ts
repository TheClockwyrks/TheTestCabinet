// parts/free-parts-cost-nothing — `void`, `rise` and `set` are charged nothing,
// so placing one leaves the machine's cost exactly where it was.
//
// THE RULE. `PART_COSTS` charges `void` `0`, `rise` `0`, and `set` `0`
// (`specs/parts.md`, Costs) — the three entries of the table that are free.
// "A machine's cost is the sum of its placed parts' costs", so a part whose cost
// is `0` adds nothing to the sum whatever else stands. The figure read is the
// machine's cost, which `specs/instrumentation.md` derives as "`PART_COSTS` over
// the parts, as `specs/parts.md` computes it" and `specs/editor.md` shows in the
// heading.
//
// THE CONFIGURATION. One challenge open in the editor, an empty machine, and then
// four placements in turn: the `void` sigil at the origin, an arm well clear of
// it, the challenge's one rise on `WEST` and its one set on `EAST`. The `void`
// goes down first, so its price is read against a machine costing `0`; the arm
// goes down next so the rise and the set are read against a machine costing
// something, which is what "leaves the cost exactly where it was" needs in order
// to say anything. `void`'s footprint is its maw and the six hexes around it
// (`specs/sigils.md`), all within one hex of the origin; the arm is anchored
// three hexes north of that, and the rise's and the set's footprints are the one
// hex of `BARE`'s single-mote reagent and product on `WEST` and `EAST` — so every
// footprint is on the field and disjoint from every other, and each placement is
// legal on its own terms. No run is started.
//
// WHY THE ARM'S OWN PRICE IS NOT ASSERTED HERE. What an `arm` costs is another
// point; this one needs only that the machine has a non-zero cost for the free
// parts to leave alone, so the arm is read as "more than nothing" rather than as
// a figure.
//
// THE VERDICT. The empty machine costs `0`; the `void` leaves it at `0`; the arm
// raises it; and the rise and the set each leave it exactly where the arm put it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { BARE, EAST, NORTH, ORIGIN, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  placeRise,
  placeSet,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The machine's cost, off a fresh snapshot. */
async function cost(): Promise<number> {
  return (await h.snapshot()).editor.cost;
}

it("leaves the machine's cost where it was when a void, a rise or a set is placed", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await h.advance(1);
  const empty = await cost();

  await placePart(h, "void", ORIGIN, 0);
  await h.advance(1);
  const withVoid = await cost();

  await placePart(h, "arm", NORTH, 0);
  await h.advance(1);
  const withArm = await cost();

  await placeRise(h, 0, WEST, 0);
  await h.advance(1);
  const withRise = await cost();

  await placeSet(h, 0, EAST, 0);
  await h.advance(1);
  const withSet = await cost();

  await captureStill(h, "free");

  assertEqual(empty, 0, "an empty machine costs 0");
  assertEqual(
    withVoid,
    empty,
    "PART_COSTS charges 0 for void, so placing one leaves the cost where it was",
  );
  assertGreaterThan(
    withArm,
    withVoid,
    "the arm gives the machine a cost for the free parts to leave alone",
  );
  assertEqual(
    withRise,
    withArm,
    "PART_COSTS charges 0 for rise, so placing one leaves the cost where it was",
  );
  assertEqual(
    withSet,
    withArm,
    "PART_COSTS charges 0 for set, so placing one leaves the cost where it was",
  );
});
