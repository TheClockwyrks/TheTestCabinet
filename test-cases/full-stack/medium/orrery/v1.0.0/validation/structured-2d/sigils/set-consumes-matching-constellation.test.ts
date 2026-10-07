// sigils/set-consumes-matching-constellation — the product goes, whole.
//
// THE RULE. "For a plain product, a constellation is accepted when it is unheld
// and is exactly the placed pattern: one mote of the pattern's type on each
// pattern hex, one filament of the pattern's weight for each pattern filament, and
// no further mote or filament in the constellation. ... An accepted constellation
// is CONSUMED WHOLE" (`specs/sigils.md`, Rises and sets). A constellation is "a
// maximal group of motes connected by filaments" (`specs/field.md`), so consuming
// it whole is the motes and the filaments between them alike.
//
// THE CONFIGURATION. A set whose product is two motes joined by a TRIUNE filament
// — weight `3`, which `specs/field.md` says is "created only as `specs/sigils.md`
// describes" — so the acceptance is read against a weight as well as against two
// types and two hexes. The constellation is posed exactly: one `nova` on each
// pattern hex at the set's placed pose, joined by one filament of weight `3`, held
// by nothing, with nothing else on the field. The machine holds the set alone: no
// rise to refill the hexes at the same boundary, and no sigil to alter the pair
// before the set reads it.
//
// THE VERDICT. After the boundary both motes are gone from `sim.motes` and the run
// carries no filament: consumed whole, rather than emptied of motes with a dangling
// link left behind.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, place } from "../field";
import { challenge } from "../formats";
import { ONE_DUST, ORIGIN, TWO_NOVA_TRIUNE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  filamentBetween,
  moteById,
  openBareRun,
  placeSet,
  spawnConstellation,
  type Harness,
} from "../harness";

/** A challenge whose one product is two `nova` joined by a triune filament. */
const TRIUNE_SET = challenge({
  name: "Triune Set",
  reagents: [ONE_DUST],
  products: [TWO_NOVA_TRIUNE],
  permitted: ["arm"],
});

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("consumes a constellation that is exactly its placed product, motes and filaments alike", async () => {
  await openBareRun(h, { challenge: TRIUNE_SET });
  await placeSet(h, 0, ORIGIN, 0);

  const pattern = TWO_NOVA_TRIUNE;
  const hexes = pattern.motes.map((entry) =>
    place(at(entry.q, entry.r), ORIGIN, 0),
  );
  const ids = await spawnConstellation(
    h,
    pattern.motes.map((entry, index) => ({
      hex: hexes[index] as { q: number; r: number },
      type: entry.type,
    })),
    pattern.filaments.map((filament) => ({
      a: pattern.motes.findIndex(
        (entry) => entry.q === filament.a.q && entry.r === filament.a.r,
      ),
      b: pattern.motes.findIndex(
        (entry) => entry.q === filament.b.q && entry.r === filament.b.r,
      ),
      weight: filament.weight,
    })),
  );

  const posed = await h.snapshot();
  assertLength(
    posed.sim?.motes ?? [],
    pattern.motes.length,
    "the posed constellation holds nothing further than the pattern's motes",
  );
  const joined = filamentBetween(posed, ids[0] as number, ids[1] as number);
  assertNotNull(joined, "the two motes are joined before the set reads them");
  assertEqual(
    joined?.weight,
    pattern.filaments[0]?.weight,
    "the filament joining them carries the pattern's weight",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "accepted");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a set that consumes raises no fault, so the run is still live",
  );
  for (const [index, id] of ids.entries()) {
    assertNull(
      moteById(after, id),
      `the mote on pattern hex ${index} is consumed with the constellation`,
    );
  }
  assertLength(
    after.sim?.motes ?? [],
    0,
    "the accepted constellation was the whole of the field, and it is gone",
  );
  assertLength(
    after.sim?.filaments ?? [],
    0,
    "the constellation was consumed whole, its filament included",
  );
});
