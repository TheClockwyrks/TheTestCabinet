// campaign/every-part-kind-placed-by-a-reference — no part kind is offered by the
// course without the course ever asking for it.
//
// THE RULE. "Across the course as a whole, every part kind in `PARTS` appears in
// at least one challenge's tray, and every part kind is placed by at least one
// reference solution" (`specs/modes/campaign.md`, The course). The first half is
// its own item; this one decides the second, which is what keeps a tray entry from
// being decoration: a kind the course offers is a kind some challenge's own
// solution puts on the field.
//
// WHERE THE REFERENCE SOLUTIONS ARE. "The reference solutions are part of the
// build and are reachable only through the surface `specs/instrumentation.md`
// defines" (`specs/modes/campaign.md`), and that surface's door is
// "`referenceSolution(mode, index)` ... A pure read: the build's own reference
// solution for that challenge, as a solution document, whatever is unlocked or
// solved" (`specs/instrumentation.md`). A solution document "is exactly the
// placements ... applied in the order `parts` lists them", so the kinds a
// reference places are the `kind` of each entry of its `parts`.
//
// THE TWENTY-ONE ARE ALL OF THEM. `PARTS` holds "the twenty-one part kinds"
// (`specs/parts.md`) — `rise` and `set` included, which every reference places
// because a reference "places every rise and set" (`specs/modes/campaign.md`), and
// `track` and the twelve transforming sigils, which only the challenges that turn
// on them place.
//
// THE VERDICT. The union of the kinds placed by the course's reference solutions
// holds all twenty-one, and a failure names the kinds no reference placed.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { PARTS, type PartName } from "../constants";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallenge,
  referenceSolution,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places every one of the twenty-one part kinds in some reference solution", async () => {
  await h.debug.reset();
  const count = (await h.snapshot()).campaign.count;

  const placed = new Set<PartName>();
  /** The reference that placed the most kinds nothing before it placed. */
  let rarest = { index: 0, added: -1 };
  for (let index = 0; index < count; index += 1) {
    const machine = await referenceSolution(h, "campaign", index);
    let added = 0;
    for (const part of machine.parts) {
      if (!placed.has(part.kind)) added += 1;
      placed.add(part.kind);
    }
    if (added > rarest.added) rarest = { index, added };
  }

  // The evidence is the reference machine that placed the most kinds of its own,
  // loaded onto the field of the challenge it solves.
  await openChallenge(h, "campaign", rarest.index);
  await loadMachine(h, await referenceSolution(h, "campaign", rarest.index));
  await h.advance(1);
  await captureStill(h, "machines");

  assertDeepEqual(
    PARTS.filter((kind) => !placed.has(kind)),
    [],
    "every part kind in PARTS is placed by at least one campaign reference " +
      "solution, and these are the kinds no reference placed",
  );
});
