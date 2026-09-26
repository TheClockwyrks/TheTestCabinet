// instrumentation/unlink-motes — `unlinkMotes` removes the filament joining two
// motes.
//
// THE RULE. "`unlinkMotes(a, b)` | Removes the filament joining `a` and `b`."
// (`specs/instrumentation.md`, The run). It removes THAT filament: "A pose sets
// one thing and leaves the rest of the game as it stands", and what a filament
// holds together is a constellation — "A constellation is a maximal group of
// motes connected by filaments. A lone mote with no filaments is a constellation
// of one" (`specs/field.md`).
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run with an empty machine and an empty
// field, and three `dust` spawned back on `(0, 0)`, `(1, 0)` and `(1, 1)`, joined
// end to end into one constellation of three. Nothing else is on the field: no
// `sunder` that could remove a filament and no `bind` that could make one, so
// every change to `sim.filaments` is one of the two calls'.
//
// THE VERDICT. The first call takes its filament out of `sim.filaments` and
// leaves the other one there — one constellation has become two, and all three
// motes still rest on the hexes they stood on. The second call names its ends the
// other way round and removes the filament all the same, because what the rule
// names is the pair rather than an order, and the field is left with none.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  constellationOf,
  createHarness,
  filamentBetween,
  moteById,
  openBareRun,
  spawnConstellation,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the filament joining two motes, and leaves the rest as they stand", async () => {
  await openBareRun(h, { challenge: BARE });
  const chain = await spawnConstellation(
    h,
    [
      { hex: at(0, 0), type: "dust" },
      { hex: at(1, 0), type: "dust" },
      { hex: at(1, 1), type: "dust" },
    ],
    [
      { a: 0, b: 1 },
      { a: 1, b: 2 },
    ],
  );
  const [first, middle, last] = [
    chain[0] ?? -1,
    chain[1] ?? -1,
    chain[2] ?? -1,
  ];
  const before = await h.snapshot();

  await h.debug.unlinkMotes(first, middle);
  const split = await h.snapshot();

  await h.debug.unlinkMotes(last, middle);
  const apart = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "split");

  assertNotNull(before.sim, "the run is live at the calls");
  assertLength(
    before.sim?.filaments ?? [],
    2,
    "the chain is joined by two filaments before the first call",
  );
  assertNull(
    filamentBetween(split, first, middle),
    "the filament joining the named pair is out of sim.filaments",
  );
  assertNotNull(
    filamentBetween(split, middle, last),
    "the filament joining the other pair stands",
  );
  assertDeepEqual(
    constellationOf(split, first),
    [first],
    "the mote the filament was removed from is a constellation of one",
  );
  assertDeepEqual(
    constellationOf(split, middle),
    [middle, last].sort((a, b) => a - b),
    "the two motes the other filament still joins are one constellation",
  );
  assertEqual(
    `${moteById(split, first)?.q},${moteById(split, first)?.r}`,
    "0,0",
    "the motes rest where they stood: only the filament was removed",
  );
  assertLength(
    apart.sim?.filaments ?? [],
    0,
    "the second call named its ends the other way round and removed its filament all the same",
  );
  assertLength(
    apart.sim?.motes ?? [],
    3,
    "all three motes are still on the field",
  );
});
