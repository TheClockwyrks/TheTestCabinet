// sigils/manifold-binds-every-reach — one boundary, three filaments.
//
// THE RULE, from `specs/sigils.md` (`manifold`): its footprint is `(0, 0)` center
// and `(1, 0)`, `(-1, +1)` and `(0, -1)` reach, and "When the center holds a mote,
// each reach hex that also holds a mote is bound to the center exactly as `bind`
// binds a pair: a weight `1` filament where none joins them yet. ONE FILAMENT IS
// CREATED FOR EACH REACH HEX holding a mote not already joined to the center."
// Every wave of the sigil phase completes before the next (`specs/simulation.md`),
// so all three are the work of this one boundary rather than of three.
//
// THE CONFIGURATION. One `manifold` anchored on `(0, 0)` at rotation `0`, and four
// `dust` motes: one on the center and one on each of the three reaches. Each is
// spawned unbonded and unheld, so "where none joins them yet" holds for all three
// pairs. Nothing else is placed and nothing else is on the field, so every
// filament reported afterwards is this manifold's.
//
// NOTHING MOVES AND NOTHING COLLIDES. A sigil carries no tape and no other part is
// on the field. At rest the center is `HEX_PITCH` (`48`) from each reach and the
// reaches are `83.14` from each other, all above `2 * MOTE_COLLIDE_R` (`38`).
//
// THE VERDICT. Exactly three filaments, one from the center to each reach, every
// one of weight `1`, and the four motes are one maximal group afterwards. No
// filament joins two reaches: the rule binds each reach TO THE CENTER, and no two
// of `(1, 0)`, `(-1, 1)` and `(0, -1)` are even adjacent, `specs/field.md` making a
// filament "a rigid link between two motes on adjacent hexes".

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
  moteById,
  openBareRun,
  solePartOfKind,
  spawnMote,
  type Harness,
} from "../harness";

/** Where the manifold is engraved. */
const ANCHOR = at(0, 0);

/** The `center` hex of `manifold`'s footprint, placed. */
const CENTER = place(at(0, 0), ANCHOR, 0);

/** The three `reach` hexes of `manifold`'s footprint, placed, in the order
 * `specs/sigils.md` tabulates them. */
const REACHES: readonly Hex[] = [at(1, 0), at(-1, 1), at(0, -1)].map((hex) =>
  place(hex, ANCHOR, 0),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates one weight 1 filament from the center to each of three occupied reaches", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("manifold", ANCHOR.q, ANCHOR.r, 0)]),
  });
  const center = await spawnMote(h, CENTER, "dust");
  const reached: number[] = [];
  for (const hex of REACHES) reached.push(await spawnMote(h, hex, "dust"));

  const before = await h.snapshot();
  assertNotNull(
    solePartOfKind(before, "manifold"),
    "the machine carries the one manifold the check placed",
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
  await captureStill(h, "three-reach");
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(sim?.status, "running", "binding three reaches halts nothing");
  assertNull(sim?.fault ?? null, "no fault is raised: nothing moves");
  assertEqual(sim?.cycle, 1, "the cycle reached its boundary");

  for (const [index, hex] of REACHES.entries()) {
    assertEqual(
      filamentBetween(snapshot, center, reached[index] ?? -1)?.weight,
      1,
      `the reach at (${hex.q}, ${hex.r}) held a mote, so this boundary bound it to the center at weight 1`,
    );
  }
  assertLength(
    sim?.filaments ?? [],
    3,
    "one filament is created for each reach hex holding a mote, three in all, at the same boundary",
  );
  assertDeepEqual(
    constellationOf(snapshot, center),
    [center, ...reached].sort((a, b) => a - b),
    "the three filaments make the four motes one maximal group",
  );

  for (const [index, hex] of REACHES.entries()) {
    const found = moteById(snapshot, reached[index] ?? -1);
    assertEqual(
      `${found?.q},${found?.r}`,
      `${hex.q},${hex.r}`,
      `the mote on the reach at (${hex.q}, ${hex.r}) is still resting on its own hex`,
    );
  }
  assertEqual(
    `${moteById(snapshot, center)?.q},${moteById(snapshot, center)?.r}`,
    `${CENTER.q},${CENTER.r}`,
    "the mote on the center is still resting on its own hex",
  );
});
