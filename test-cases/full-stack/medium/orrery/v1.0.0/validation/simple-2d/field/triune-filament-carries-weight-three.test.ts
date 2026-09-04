// field/triune-filament-carries-weight-three — a triune filament carries weight 3.
//
// THE RULE. A filament "carries a `weight` of `1` or `3`; A WEIGHT OF `3` IS A
// TRIUNE FILAMENT, created only as `specs/sigils.md` describes"
// (`specs/field.md`, Filaments and constellations) — and there, the `triune`
// sigil: "when both hexes hold `nova` motes and no filament joins that pair, a
// filament of weight `3` is created between them" (`specs/sigils.md`). The weight
// is the whole of what makes a filament triune, so the two weights have to stay
// apart: a set matching a plain product wants "one filament of the pattern's
// weight for each pattern filament", and a build that reported every filament at
// one weight would accept a triune constellation for a plain product and refuse
// the plain one for a triune.
//
// WHAT IS READ. `linkMotes(a, b, weight)` "joins motes `a` and `b` with one
// filament of `weight` `1` or `3`" (`specs/instrumentation.md`), and the snapshot
// reports it back as `sim.filaments`, "`[{ a, b, weight: 1 | 3 }]`".
//
// THE CONFIGURATION. Two pairs on one field, far enough apart to share nothing:
// two `nova` on adjacent hexes joined at weight `3`, which is the pair `triune`
// itself makes, and two `luna` on adjacent hexes joined at weight `1`. The plain
// pair is what makes the reading a DISTINCTION rather than a constant — a build
// that reported `3` for everything would satisfy the triune half alone.
//
// THE VERDICT is paired with the constellations the two filaments make — "a
// constellation is a maximal group of motes connected by filaments"
// (`specs/field.md`) — so each weight is read off a filament that really joined
// its own pair, and the two pairs are two constellations rather than one.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field and the
// machine, so the four motes are the whole of the world and no part is on the
// field to move them. No `triune` sigil is placed and no boundary is crossed: the
// weight is posed directly, because what this point decides is that the weight is
// CARRIED, not that a sigil produces it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
} from "../assert";
import { neighbor } from "../field";
import { BARE, ORIGIN, SOUTH } from "../fixtures";
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

it("reports a filament created at weight 3 with weight 3, beside a weight 1", async () => {
  await openBareRun(h, { challenge: BARE });

  const triune = await spawnConstellation(
    h,
    [
      { hex: ORIGIN, type: "nova" },
      { hex: neighbor(ORIGIN, 0), type: "nova" },
    ],
    [{ a: 0, b: 1, weight: 3 }],
  );
  const plain = await spawnConstellation(
    h,
    [
      { hex: SOUTH, type: "luna" },
      { hex: neighbor(SOUTH, 0), type: "luna" },
    ],
    [{ a: 0, b: 1, weight: 1 }],
  );

  await h.advance(1);
  await captureStill(h, "triune");

  const snapshot = await h.snapshot();
  assertLength(
    snapshot.sim?.motes ?? [],
    4,
    "the field holds the two pairs and nothing else",
  );
  assertLength(
    snapshot.sim?.filaments ?? [],
    2,
    "one filament per pair, and two pairs were joined",
  );

  const heavy = filamentBetween(
    snapshot,
    triune[0] as number,
    triune[1] as number,
  );
  assertNotNull(heavy, "the two nova are joined by a filament");
  assertEqual(
    heavy?.weight,
    3,
    "a filament created at weight 3 is reported at weight 3, which is a triune filament",
  );

  const light = filamentBetween(
    snapshot,
    plain[0] as number,
    plain[1] as number,
  );
  assertNotNull(light, "the two luna are joined by a filament");
  assertEqual(
    light?.weight,
    1,
    "the weight 1 filament in the same machine keeps its own weight",
  );

  assertDeepEqual(
    constellationOf(snapshot, triune[0] as number),
    [...triune].sort((a, b) => a - b),
    "the triune filament joins its own pair into one constellation",
  );
  assertDeepEqual(
    constellationOf(snapshot, plain[0] as number),
    [...plain].sort((a, b) => a - b),
    "and the plain filament joins its own, so the two pairs stay two constellations",
  );
});
