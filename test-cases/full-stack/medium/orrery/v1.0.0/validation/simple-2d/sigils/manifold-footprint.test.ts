// sigils/manifold-footprint — which three of the center's six neighbors are
// reaches.
//
// THE RULE. `specs/sigils.md` tabulates `manifold`'s footprint and names exactly
// four hexes: "`(0, 0)` | center", "`(1, 0)` | reach", "`(-1, +1)` | reach",
// "`(0, -1)` | reach". Its effect reaches no further: "each reach hex that also
// holds a mote is bound to the center". The center's other three neighbors —
// `(0, 1)`, `(-1, 0)` and `(1, -1)`, which are `DIRS[1]`, `DIRS[3]` and `DIRS[5]`
// of `specs/field.md` — carry no role at all, so a mote on one of them is a mote
// standing beside a sigil, not on it.
//
// THE CONFIGURATION. One `manifold` anchored on `(0, 0)` at rotation `0`, one
// `dust` on the center, and a `dust` on ALL SIX of the center's neighbors — the
// three reaches and the three hexes that are not reaches. Posing both halves at
// one boundary is what makes the check about WHICH neighbors: a build that binds
// every neighbor and a build that binds the right three are told apart in the same
// reading.
//
// NOTHING MOVES AND NOTHING COLLIDES. A sigil carries no tape and no other part is
// on the field. At rest every one of these seven hexes is `HEX_PITCH` (`48`) or
// more from every other, above `2 * MOTE_COLLIDE_R` (`38`).
//
// THE VERDICT. Exactly three filaments, from the center to `(1, 0)`, `(-1, 1)` and
// `(0, -1)`; nothing joins the center to `(0, 1)`, `(-1, 0)` or `(1, -1)`, and
// those three motes are still constellations of one.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, place, type Hex } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  constellationOf,
  createHarness,
  filamentBetween,
  openBareRun,
  solePartOfKind,
  spawnMote,
  type Harness,
} from "../harness";

/** Where the manifold is engraved. */
const ANCHOR = at(0, 0);

/** The `center` hex of `manifold`'s footprint, placed. */
const CENTER = place(at(0, 0), ANCHOR, 0);

/** The three hexes `specs/sigils.md` gives the `reach` role to, placed. */
const REACHES: readonly Hex[] = [at(1, 0), at(-1, 1), at(0, -1)].map((hex) =>
  place(hex, ANCHOR, 0),
);

/** The center's other three neighbors, which the footprint does not name. */
const OUTSIDE: readonly Hex[] = [at(0, 1), at(-1, 0), at(1, -1)].map((hex) =>
  place(hex, ANCHOR, 0),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("binds the three neighbors its footprint names and no other neighbor", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("manifold", ANCHOR.q, ANCHOR.r, 0)]),
  });
  const center = await spawnMote(h, CENTER, "dust");
  const reached: number[] = [];
  for (const hex of REACHES) reached.push(await spawnMote(h, hex, "dust"));
  const bystanders: number[] = [];
  for (const hex of OUTSIDE) bystanders.push(await spawnMote(h, hex, "dust"));

  const before = await h.snapshot();
  assertNotNull(
    solePartOfKind(before, "manifold"),
    "the machine carries the one manifold the check placed",
  );
  assertLength(
    before.sim?.motes ?? [],
    7,
    "the center and all six of its neighbors hold a mote when the boundary runs",
  );
  assertLength(
    before.sim?.filaments ?? [],
    0,
    "no filament joins any pair when the boundary runs",
  );

  await advanceCycles(h, 1);
  // The verdict is the state the BOUNDARY left. The frame after it is only
  // what puts the picture on the canvas for the evidence below.
  const snapshot = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "footprint");
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(sim?.status, "running", "binding three reaches halts nothing");
  assertNull(sim?.fault ?? null, "no fault is raised: nothing moves");
  assertEqual(sim?.cycle, 1, "the cycle reached its boundary");

  for (const [index, hex] of REACHES.entries()) {
    assertEqual(
      filamentBetween(snapshot, center, reached[index] ?? -1)?.weight,
      1,
      `(${hex.q}, ${hex.r}) is a reach of manifold's footprint, so this boundary bound it to the center`,
    );
  }
  for (const [index, hex] of OUTSIDE.entries()) {
    assertNull(
      filamentBetween(snapshot, center, bystanders[index] ?? -1),
      `(${hex.q}, ${hex.r}) carries no role in manifold's footprint, so nothing joins the mote on it to the center`,
    );
    assertDeepEqual(
      constellationOf(snapshot, bystanders[index] ?? -1),
      [bystanders[index] ?? -1],
      `the mote on (${hex.q}, ${hex.r}) is still a constellation of one`,
    );
  }
  assertLength(
    sim?.filaments ?? [],
    3,
    "a manifold's reaches are the three hexes its footprint names, so three filaments and no more",
  );
});
