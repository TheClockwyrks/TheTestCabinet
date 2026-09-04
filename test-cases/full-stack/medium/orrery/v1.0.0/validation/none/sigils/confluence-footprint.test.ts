// sigils/confluence-footprint — a confluence reads its own five hexes, and the
// anchor's two other neighbors take no part.
//
// THE RULE. "Footprints are written as relative hexes at rotation `0`; a placed
// sigil's hexes are its footprint rotated and translated" (`specs/sigils.md`),
// and `confluence`'s footprint is exactly five: the crown on `(0, 0)` and founts
// on `(1, 0)`, `(0, 1)`, `(-1, 0)` and `(0, -1)`. The anchor has six neighbors,
// so two of them — `(-1, 1)` and `(1, -1)` — carry no role at all, and a mote
// resting on one of them is none of "the four founts" the effect reads: "When
// the four founts hold unbonded, unheld motes comprising one of each essence, in
// any arrangement, and the crown is vacant, all four are consumed and one
// `aether` appears on the crown."
//
// THE CONFIGURATION, twice, on one `confluence` anchored on the middle of the
// field at rotation `0`. The two hexes off the footprint are computed from the
// footprint the case's oracle derives, never written down.
//
//   * First, three essences on three founts with the fourth fount EMPTY, and a
//     `meteor` — the missing essence — on EACH of the two neighbors off the
//     footprint. A build reading either of them as a fount would find one of
//     each essence over a vacant crown, and would fuse.
//   * Then the four essences on the four founts, with a `dust` on each of those
//     two neighbors. A build that read them would find the crown's neighbors
//     holding something other than an essence.
//
// THE VERDICT. The first boundary consumes nothing and leaves the crown vacant;
// the second consumes the four founts and leaves one `aether` on the crown, the
// anchor hex. The two motes off the footprint survive both boundaries untouched,
// so they neither fed a confluence nor blocked one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { ESSENCES } from "../constants";
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
  const crown = place(at(0, 0), anchor, rotation);
  const founts = [at(1, 0), at(0, 1), at(-1, 0), at(0, -1)].map((hex) =>
    place(hex, anchor, rotation),
  );
  const footprint = sigilHexes("confluence", anchor, rotation);
  const bystanders = neighbors(anchor).filter(
    (hex) => !footprint.some((own) => sameHex(own, hex)),
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("confluence", anchor.q, anchor.r, rotation)]),
  });
  assertEqual(
    bystanders.length,
    2,
    "four of the anchor's six neighbors are founts and two are not",
  );

  // Scenario one: three founts filled, the fourth empty, and the missing
  // essence sitting on both hexes off the footprint.
  const missing = ESSENCES[ESSENCES.length - 1];
  const partial: number[] = [];
  for (let index = 0; index < founts.length - 1; index += 1) {
    partial.push(await spawnMote(h, founts[index], ESSENCES[index]));
  }
  const off: number[] = [];
  for (const hex of bystanders) off.push(await spawnMote(h, hex, missing));

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
  assertNull(
    moteAt(waited, founts[founts.length - 1]),
    "the fourth fount stayed empty through the boundary",
  );
  assertNull(moteAt(waited, crown), "no aether appears on the crown");
  for (let index = 0; index < partial.length; index += 1) {
    assertEqual(
      moteAt(waited, founts[index])?.id,
      partial[index],
      `the essence on the fount at (${founts[index].q}, ${founts[index].r}) is left as it was`,
    );
  }
  for (const [index, hex] of bystanders.entries()) {
    assertEqual(
      moteAt(waited, hex)?.id,
      off[index],
      `the mote on (${hex.q}, ${hex.r}) is off the footprint and takes no part`,
    );
  }
  assertEqual(
    looseMotes(waited).length,
    5,
    "five motes went into the boundary and five came out",
  );

  // Scenario two: the four founts filled, with a mote still on each hex off the
  // footprint.
  await h.debug.clearMotes();
  const filled: number[] = [];
  for (const [index, hex] of founts.entries()) {
    filled.push(await spawnMote(h, hex, ESSENCES[index]));
  }
  const spare: number[] = [];
  for (const hex of bystanders) spare.push(await spawnMote(h, hex, "dust"));

  await advanceCycles(h, 1);

  const fused = await h.snapshot();
  assertEqual(
    fused.sim?.status,
    "running",
    "the second boundary is not a fault either",
  );
  for (const id of filled) {
    assertNull(
      moteById(fused, id),
      `the essence ${id} on its fount was consumed`,
    );
  }
  assertNotNull(moteAt(fused, crown), "the aether appears on the crown");
  assertEqual(
    moteAt(fused, crown)?.type,
    "aether",
    "the crown is the anchor hex, and it is where the aether lands",
  );
  for (const [index, hex] of bystanders.entries()) {
    assertEqual(
      moteAt(fused, hex)?.id,
      spare[index],
      `the mote on (${hex.q}, ${hex.r}) neither blocked the fusion nor fed it`,
    );
  }
  assertEqual(
    looseMotes(fused).length,
    3,
    "the four founts became one mote, and the two off the footprint stand",
  );
});
