// field/plain-filament-carries-weight-one — a plain filament carries weight 1.
//
// THE RULE. A filament "carries a `weight` of `1` or `3`; a weight of `3` is a
// triune filament, created only as `specs/sigils.md` describes"
// (`specs/field.md`, Filaments and constellations). `1` is the plain weight — the
// one `bind` makes ("a filament of weight `1` is created between them",
// `specs/sigils.md`) and the one a plain product's pattern is matched against: a
// set accepts a constellation that is "exactly the placed pattern: one mote of
// the pattern's type on each pattern hex, ONE FILAMENT OF THE PATTERN'S WEIGHT
// for each pattern filament" (`specs/sigils.md`, `set`). So a build that reported
// a weight of its own choosing would fail every plain delivery in the game.
//
// WHAT IS READ. `linkMotes(a, b, weight)` "joins motes `a` and `b` with one
// filament of `weight` `1` or `3`" (`specs/instrumentation.md`), and the snapshot
// reports it back as `sim.filaments`, "`[{ a: <mote id>, b: <mote id>,
// weight: 1 | 3 }]`". A filament created at weight `1` is reported at weight `1`.
//
// THE CONFIGURATION. Two motes on adjacent hexes — `(0, 0)` and its eastern
// neighbour, `DIRS[0]` — joined at weight `1`, and nothing else on the field.
// "At most one filament joins a given pair of motes" (`specs/field.md`), so the
// one filament is the whole of `sim.filaments` and the reading cannot be some
// other pair's.
//
// THE VERDICT is paired with the constellation the filament makes — "a
// constellation is a maximal group of motes connected by filaments"
// (`specs/field.md`) — so the weight is read off a filament that really joined
// the two rather than one recorded and ignored.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field and the
// machine, so the two motes are the whole of the world and no part is on the
// field to move them.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
} from "../assert";
import { neighbor } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  constellationOf,
  createHarness,
  filamentBetween,
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

it("reports a filament created at weight 1 with weight 1", async () => {
  const east = neighbor(ORIGIN, 0);

  await openBareRun(h, { challenge: BARE });
  const ids = await spawnConstellation(
    h,
    [
      { hex: ORIGIN, type: "luna" },
      { hex: east, type: "luna" },
    ],
    [{ a: 0, b: 1, weight: 1 }],
  );

  await h.advance(1);
  await captureStill(h, "plain");

  const snapshot = await h.snapshot();
  assertLength(
    snapshot.sim?.motes ?? [],
    2,
    "the field holds the joined pair and nothing else",
  );
  assertLength(
    snapshot.sim?.filaments ?? [],
    1,
    "one filament joins the pair, and at most one may",
  );

  const filament = filamentBetween(
    snapshot,
    ids[0] as number,
    ids[1] as number,
  );
  assertNotNull(filament, "the pair is joined by a filament");
  assertEqual(
    filament?.weight,
    1,
    "a filament created at weight 1 is reported at weight 1",
  );
  assertDeepEqual(
    constellationOf(snapshot, ids[0] as number),
    [...ids].sort((a, b) => a - b),
    "the filament joins the two into one constellation",
  );
});
