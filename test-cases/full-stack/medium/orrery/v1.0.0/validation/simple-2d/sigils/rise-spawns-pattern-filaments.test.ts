// sigils/rise-spawns-pattern-filaments — the delivered reagent arrives joined.
//
// THE RULE. "When every footprint hex is vacant, the reagent appears: one new mote
// per pattern mote and ONE FILAMENT PER PATTERN FILAMENT, at the placed pose,
// unheld" (`specs/sigils.md`, Rises and sets). A pattern filament "joins two
// distinct mote hexes of this molecule that are adjacent, `weight` is `1` or `3`"
// (`specs/formats.md`), and "Filament endpoints rotate the same way"
// (`specs/field.md`) — so a delivered filament joins the two spawned motes standing
// on the placed ends of the pattern's own filament, at the pattern's weight.
//
// THE CHALLENGE IS POSED, NOT SHIPPED. Its reagent carries TWO filaments of
// DIFFERENT WEIGHTS — the `3` `specs/field.md` calls a triune filament and a plain
// `1` — so a build that delivered one filament, or delivered both at weight `1`,
// fails. "At most one filament joins a given pair of motes" (`specs/field.md`), so
// the count and the pairs together say the whole of it.
//
// THE WORLD IS THE RISE. The bare opener clears the field, and the machine holds
// the one rise: no `bind` to add a filament and no `sunder` to take one away, so
// every filament on the field at the boundary came from the delivery.
//
// THE VERDICT. The run carries exactly as many filaments as the pattern does, and
// for each pattern filament the motes on its two placed hexes are joined at that
// pattern filament's weight.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { at, place } from "../field";
import { challenge, link, molecule, mote } from "../formats";
import { ONE_DUST, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  filamentBetween,
  moteAt,
  openBareRun,
  placeRise,
  type Harness,
} from "../harness";

/** Three motes joined by a triune filament and a plain one. */
const WEIGHTED = molecule(
  [mote(0, 0, "nova"), mote(1, 0, "nova"), mote(0, 1, "dust")],
  [link(at(0, 0), at(1, 0), 3), link(at(0, 0), at(0, 1), 1)],
);

/** A challenge whose one reagent is that shape. */
const WEIGHTED_RISE = challenge({
  name: "Weighted Rise",
  reagents: [WEIGHTED],
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

it("delivers one filament per pattern filament, at its weight, between the right pair", async () => {
  await openBareRun(h, { challenge: WEIGHTED_RISE });
  await placeRise(h, 0, ORIGIN, 0);

  await advanceCycles(h, 1);
  await captureStill(h, "filaments");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a rise that delivers raises no fault, so the run is still live",
  );
  assertLength(
    after.sim?.filaments ?? [],
    WEIGHTED.filaments.length,
    "one filament per pattern filament, and nothing further",
  );
  for (const pattern of WEIGHTED.filaments) {
    const a = place(pattern.a, ORIGIN, 0);
    const b = place(pattern.b, ORIGIN, 0);
    const first = moteAt(after, a);
    const second = moteAt(after, b);
    assertNotNull(
      first,
      `a delivered mote rests on (${a.q}, ${a.r}), one end of a pattern filament`,
    );
    assertNotNull(
      second,
      `a delivered mote rests on (${b.q}, ${b.r}), the other end of that filament`,
    );
    const joined = filamentBetween(after, first?.id ?? -1, second?.id ?? -1);
    assertNotNull(
      joined,
      `a filament joins the pair the pattern joins, (${a.q}, ${a.r}) to (${b.q}, ${b.r})`,
    );
    assertEqual(
      joined?.weight,
      pattern.weight,
      `that filament carries the pattern's weight of ${pattern.weight}`,
    );
  }
});
