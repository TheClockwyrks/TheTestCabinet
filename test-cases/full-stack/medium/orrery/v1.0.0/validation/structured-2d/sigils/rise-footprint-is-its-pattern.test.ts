// sigils/rise-footprint-is-its-pattern — the footprint is the pattern, no wider.
//
// THE RULE. "A rise or set is placed at an anchor and rotation like any sigil, and
// its footprint is its pattern's hexes placed at that pose: THE MOLECULE PATTERN
// FOR A RISE" (`specs/parts.md`, Rises and sets), and the condition reads that
// footprint and nothing else: "When every footprint hex is vacant, the reagent
// appears" (`specs/sigils.md`). So a hex that is not one of the pattern's hexes is
// not the rise's business, however close it lies.
//
// THE CONFIGURATION. A rise whose reagent is two motes, so its footprint is two
// hexes, with a `dust` on EVERY hex adjacent to that footprint and outside it —
// eight of them, computed from `specs/field.md`'s `DIRS` through `field.ts` rather
// than chosen by hand. That is the strongest form of the item's claim: if any hex
// beyond the pattern belonged to the footprint, one of the eight would be on it.
// Nothing moves — the machine holds the one rise — and motes at rest on adjacent
// hexes stand `HEX_PITCH` (`48`) apart, never within the collision threshold of
// `38` (`specs/simulation.md`).
//
// THE VERDICT. The reagent is delivered onto both pattern hexes at the boundary,
// all eight neighbours are still where they were spawned, and the field holds
// exactly ten motes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { at, neighbors, place, sameHex, type Hex } from "../field";
import { challenge } from "../formats";
import { ONE_DUST, ORIGIN, TWO_LUNA } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  moteAt,
  openBareRun,
  placeRise,
  spawnMote,
  type Harness,
} from "../harness";

/** A challenge whose one reagent is two `luna` joined east. */
const TWIN_RISE = challenge({
  name: "Twin Rise",
  reagents: [TWO_LUNA],
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

it("delivers with a mote on every hex adjacent to the footprint but outside it", async () => {
  await openBareRun(h, { challenge: TWIN_RISE });
  await placeRise(h, 0, ORIGIN, 0);

  const footprint = TWO_LUNA.motes.map((entry) =>
    place(at(entry.q, entry.r), ORIGIN, 0),
  );
  const around: Hex[] = [];
  for (const hex of footprint) {
    for (const near of neighbors(hex)) {
      if (footprint.some((cell) => sameHex(cell, near))) continue;
      if (around.some((cell) => sameHex(cell, near))) continue;
      around.push(near);
    }
  }
  assertLength(
    around,
    8,
    "two adjacent hexes have eight neighbours between them that are not either of them",
  );

  const beside: number[] = [];
  for (const hex of around) beside.push(await spawnMote(h, hex, "dust"));

  await advanceCycles(h, 1);
  await captureStill(h, "adjacent");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "ten motes at rest hold 48 between neighbours, which is not within 38",
  );
  for (const [index, hex] of footprint.entries()) {
    assertNotNull(
      moteAt(after, hex),
      `the reagent's mote ${index} rests on (${hex.q}, ${hex.r}): a mote beside the footprint does not block the spawn`,
    );
  }
  for (const [index, hex] of around.entries()) {
    assertEqual(
      moteAt(after, hex)?.id,
      beside[index],
      `the mote on (${hex.q}, ${hex.r}), adjacent to the footprint, is untouched`,
    );
  }
  assertLength(
    after.sim?.motes ?? [],
    around.length + TWO_LUNA.motes.length,
    "the eight neighbours and the two delivered motes are the whole of the field",
  );
});
