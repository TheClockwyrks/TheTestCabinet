// sigils/conjoin-footprint — a conjoin reads its own three hexes and no other
// neighbor of its anchor.
//
// THE RULE. "Footprints are written as relative hexes at rotation `0`; a placed
// sigil's hexes are its footprint rotated and translated" (`specs/sigils.md`),
// and `conjoin`'s footprint is exactly three: `(0, 0)` fount, `(1, 0)` fount,
// `(0, 1)` crown. A hex outside the footprint carries no role, so a mote resting
// on it is not one of the "both founts" the effect reads — "When both founts
// hold unbonded, unheld motes of the same planet below `sol` and the crown is
// vacant, both are consumed and one mote of the next rung appears on the crown."
//
// THE CONFIGURATION, twice, on one `conjoin` anchored on the middle of the field
// at rotation `0`. The anchor has six neighbors and two of them are footprint
// hexes; the other four — computed here from the footprint the case's oracle
// derives, never written down — hold a `mars` each in both scenarios.
//
//   * First, a `mars` on the anchor fount alone, with the fount at `(1, 0)`
//     EMPTY. Four `mars` sit one step from the anchor, so a build reading any of
//     them as the second fount would find two of one planet below `sol` and a
//     vacant crown, and would fuse them.
//   * Then the same field with one further `mars` added, on the fount at
//     `(1, 0)`. Nothing else about the world changes.
//
// The two differ by one mote on one hex, so what separates them is which hexes
// the footprint names and nothing else. `clearMotes` empties the field between
// them, leaving the sigil placed.
//
// THE VERDICT. The first boundary consumes nothing and leaves the crown vacant;
// the second consumes the two founts and leaves the next rung on the crown. The
// four motes off the footprint are untouched by both, so they take no part in
// either direction.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { PLANETS } from "../constants";
import { at, neighbors, place, sameHex } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import { sigilHexes } from "../parts";
import {
  advanceCycles,
  captureStill,
  createHarness,
  looseMotes,
  moteAt,
  moteById,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes no mote off its footprint for a fount", async () => {
  const anchor = ORIGIN;
  const rotation = 0;
  const first = place(at(0, 0), anchor, rotation);
  const second = place(at(1, 0), anchor, rotation);
  const crown = place(at(0, 1), anchor, rotation);
  const footprint = sigilHexes("conjoin", anchor, rotation);
  const bystanders = neighbors(anchor).filter(
    (hex) => !footprint.some((own) => sameHex(own, hex)),
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("conjoin", anchor.q, anchor.r, rotation)]),
  });
  assertEqual(
    bystanders.length,
    4,
    "two of the anchor's six neighbors are footprint hexes and four are not",
  );

  // Scenario one: the second fount is EMPTY, and four mars ring the anchor.
  const seated = await spawnMote(h, first, "mars");
  const off: number[] = [];
  for (const hex of bystanders) off.push(await spawnMote(h, hex, "mars"));

  await advanceCycles(h, 1);
  await captureStill(h, "footprint");

  const waited = await h.snapshot();
  assertEqual(
    waited.sim?.status,
    "running",
    "a waiting sigil is not a fault: the cycle reached its boundary",
  );
  assertEqual(
    waited.sim?.cycle,
    1,
    "one whole cycle ran, so a boundary passed",
  );
  assertEqual(
    moteAt(waited, first)?.id,
    seated,
    "the mars on the anchor fount is left as it was",
  );
  assertNull(
    moteAt(waited, crown),
    "no mote appears on the crown, so no pair was fused",
  );
  for (const [index, hex] of bystanders.entries()) {
    assertEqual(
      moteAt(waited, hex)?.id,
      off[index],
      `the mars on (${hex.q}, ${hex.r}) is off the footprint and takes no part`,
    );
  }
  assertEqual(
    looseMotes(waited).length,
    5,
    "five motes went into the boundary and five came out",
  );

  // Scenario two: the same field with a mars added on the fount at (1, 0).
  await h.debug.clearMotes();
  const west = await spawnMote(h, first, "mars");
  const east = await spawnMote(h, second, "mars");
  const again: number[] = [];
  for (const hex of bystanders) again.push(await spawnMote(h, hex, "mars"));

  await advanceCycles(h, 1);

  const fused = await h.snapshot();
  assertEqual(
    fused.sim?.status,
    "running",
    "the second boundary is not a fault either",
  );
  assertNull(
    moteById(fused, west),
    "the mote on the fount at (0, 0) is consumed",
  );
  assertNull(
    moteById(fused, east),
    "the mote on the fount at (1, 0) is consumed",
  );
  const risen = PLANETS[PLANETS.indexOf("mars") + 1];
  assertNotNull(moteAt(fused, crown), "the next rung appears on the crown");
  assertEqual(
    moteAt(fused, crown)?.type,
    risen,
    "the crown is the footprint hex the new mote lands on",
  );
  for (const [index, hex] of bystanders.entries()) {
    assertEqual(
      moteAt(fused, hex)?.id,
      again[index],
      `the mars on (${hex.q}, ${hex.r}) is untouched by the fusion as well`,
    );
  }
  assertEqual(
    looseMotes(fused).length,
    5,
    "the two founts became one mote, and the four off the footprint stand",
  );
});
