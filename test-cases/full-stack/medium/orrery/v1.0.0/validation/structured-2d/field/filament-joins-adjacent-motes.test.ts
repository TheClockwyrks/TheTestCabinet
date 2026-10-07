// field/filament-joins-adjacent-motes — a filament joins motes across each of the
// six adjacencies.
//
// THE RULE. "A filament is a rigid link between two motes on ADJACENT hexes"
// (`specs/field.md`, Filaments and constellations), and adjacency is the whole of
// `DIRS`: "`DIRS` holds the six neighbor offsets, indexed `0` to `5`, in
// clockwise order on the stage starting from east ... Two hexes are adjacent when
// their difference is one of `DIRS`" (`specs/field.md`, Directions and rotation).
// All six, not three: the offsets are `(+1, 0)`, `(0, +1)`, `(-1, +1)`, `(-1, 0)`,
// `(0, -1)` and `(+1, -1)`, and a build that treated adjacency as a subset — the
// three "forward" offsets, say, with the reverse of each left out — would refuse
// half the filaments a machine has to make.
//
// WHAT IS READ. `linkMotes(a, b, weight)` "joins motes `a` and `b` with one
// filament", and "motes on hexes that are not adjacent ... throw"
// (`specs/instrumentation.md`), so a link that is made at all is a link across an
// adjacency the build accepts. The snapshot reports the result as
// `sim.filaments`, "`[{ a: <mote id>, b: <mote id>, weight: 1 | 3 }]`".
//
// THE CONFIGURATION. One mote on `(0, 0)` and one on each of its six neighbours —
// `(0, 0)` plus each entry of `DIRS` — with the center joined to each of the six.
// Every one of the six adjacencies is exercised at once, from one hex, so the six
// verdicts are about the six offsets rather than about six different places on
// the field. Only the six center-to-neighbour pairs are linked; the neighbours
// are adjacent to one another too, and nothing joins them, which is what makes
// "one filament per pair" a count of six rather than of whatever was reachable.
//
// THE VERDICT. Each of the six pairs carries a filament, `sim.filaments` holds
// exactly six, and the whole seven motes are one constellation — "a constellation
// is a maximal group of motes connected by filaments" (`specs/field.md`) — so the
// six really joined rather than being recorded and ignored.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field and the
// machine, so the seven motes are the whole of the world and nothing can move
// them: no part is on the field, so no motion step runs.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import { DIRS } from "../constants";
import { adjacent, neighbor, type Hex } from "../field";
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

it("joins the center to each of its six neighbours, one filament per pair", async () => {
  assertLength(DIRS, 6, "DIRS holds the six neighbor offsets");

  const around: Hex[] = [0, 1, 2, 3, 4, 5].map((d) => neighbor(ORIGIN, d));
  for (const [d, hex] of around.entries()) {
    assertTrue(
      adjacent(ORIGIN, hex),
      `DIRS[${d}] carries (0, 0) onto (${hex.q}, ${hex.r}), which is adjacent to it`,
    );
  }

  await openBareRun(h, { challenge: BARE });
  const ids = await spawnConstellation(
    h,
    [
      { hex: ORIGIN, type: "dust" },
      ...around.map((hex) => ({ hex, type: "dust" as const })),
    ],
    [0, 1, 2, 3, 4, 5].map((d) => ({ a: 0, b: d + 1 })),
  );

  await h.advance(1);
  await captureStill(h, "joined");

  const center = ids[0] as number;
  const snapshot = await h.snapshot();
  assertLength(
    snapshot.sim?.motes ?? [],
    7,
    "the field holds the center and its six neighbours and nothing else",
  );

  for (const [d, hex] of around.entries()) {
    const where = `DIRS[${d}] = (${DIRS[d]?.[0]}, ${DIRS[d]?.[1]}), (0, 0) to (${hex.q}, ${hex.r})`;
    const filament = filamentBetween(snapshot, center, ids[d + 1] as number);
    assertNotNull(filament, `${where}: a filament joins the pair`);
    assertEqual(
      filament?.weight,
      1,
      `${where}: the filament was created at weight 1`,
    );
  }

  assertLength(
    snapshot.sim?.filaments ?? [],
    6,
    "one filament per linked pair, and six pairs were linked",
  );
  assertDeepEqual(
    constellationOf(snapshot, center),
    [...ids].sort((a, b) => a - b),
    "the six filaments make one constellation of all seven motes",
  );
});
