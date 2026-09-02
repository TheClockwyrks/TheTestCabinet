// sigils/set-rejects-extra-filament — a constellation carrying one further
// filament holds more than the pattern, and the set refuses it.
//
// THE RULE. "For a plain product, a constellation is accepted when it is unheld
// and is exactly the placed pattern: one mote of the pattern's type on each
// pattern hex, one filament of the pattern's weight for each pattern filament,
// AND NO FURTHER MOTE OR FILAMENT IN THE CONSTELLATION" (`specs/sigils.md`,
// Rises and sets). The last clause names filaments as well as motes: a
// constellation whose motes and hexes are the pattern's exactly, and which
// carries one filament the pattern does not, is not the placed pattern.
//
// THE CONFIGURATION. A product of three `dust` on the mutually adjacent hexes
// `(0, 0)`, `(1, 0)` and `(0, 1)` — adjacent because each difference is one of
// `DIRS` (`specs/field.md`) — joined by TWO filaments of weight `1`, from
// `(0, 0)` to each of the others. The pattern is connected, as
// `specs/formats.md` requires, and it deliberately leaves the third adjacent
// pair, `(1, 0)` and `(0, 1)`, unjoined: that is the pair a further filament can
// occupy without moving a single mote.
//
// Its set is placed at the middle of the field at rotation `0`, so its pattern
// hexes are exactly those three. Nothing else is on the field.
//
// THE VERDICT, in two phases over the one posed world, differing by ONE FILAMENT
// and by nothing else at all — the same three motes, on the same three hexes,
// throughout:
//
//   1. The pattern's three motes and its two filaments, plus a third filament
//      between the two motes the pattern leaves unjoined. At the boundary the
//      set accepts nothing: the tally stands at `0` and all three motes are
//      still resting on the pattern's hexes.
//   2. THE SET IS LIVE. The further filament is removed. At the next boundary
//      the constellation is exactly the placed pattern, it is consumed, and the
//      tally rises by one — so the refusal was about the extra filament rather
//      than about a set that accepts nothing at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at } from "../field";
import {
  challenge,
  link,
  loneMote,
  molecule,
  mote,
  setPart,
  solution,
} from "../formats";
import { ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  filamentBetween,
  moteAt,
  openBareRun,
  spawnConstellation,
  tallyOf,
  type Harness,
} from "../harness";

/**
 * Three `dust` on `(0, 0)`, `(1, 0)` and `(0, 1)`, joined from `(0, 0)` to each
 * of the others. The pair `(1, 0)`–`(0, 1)` is adjacent and left unjoined.
 */
const PRODUCT = molecule(
  [mote(0, 0, "dust"), mote(1, 0, "dust"), mote(0, 1, "dust")],
  [link(at(0, 0), at(1, 0), 1), link(at(0, 0), at(0, 1), 1)],
);

const TRIANGLE = challenge({
  name: "Triangle Product",
  reagents: [loneMote("dust")],
  products: [PRODUCT],
  permitted: ["arm", "bind"],
});

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a constellation that is the pattern plus one filament more", async () => {
  await openBareRun(h, {
    challenge: TRIANGLE,
    machine: solution([setPart(0, ORIGIN.q, ORIGIN.r, 0)]),
  });

  const hub = at(ORIGIN.q, ORIGIN.r);
  const east = at(ORIGIN.q + 1, ORIGIN.r);
  const southeast = at(ORIGIN.q, ORIGIN.r + 1);

  // 1. The pattern's three motes and two filaments, plus a third filament.
  const [center, arm, leg] = await spawnConstellation(
    h,
    [
      { hex: hub, type: "dust" },
      { hex: east, type: "dust" },
      { hex: southeast, type: "dust" },
    ],
    [
      { a: 0, b: 1, weight: 1 },
      { a: 0, b: 2, weight: 1 },
      { a: 1, b: 2, weight: 1 },
    ],
  );

  await advanceCycles(h, 1);
  await captureStill(h, "extra-filament");

  const overJoined = await h.snapshot();
  assertNotNull(overJoined.sim, "the run is still live at the first boundary");
  assertNotNull(
    filamentBetween(overJoined, arm ?? -1, leg ?? -1),
    "the further filament is on the field at the boundary that reads it",
  );
  assertEqual(
    tallyOf(overJoined, 0),
    0,
    "a constellation carrying a further filament holds more than the pattern, so nothing is accepted",
  );
  assertEqual(
    moteAt(overJoined, hub)?.id,
    center,
    "the refused constellation is left resting on the pattern's first hex",
  );
  assertEqual(
    moteAt(overJoined, east)?.id,
    arm,
    "the refused constellation is left resting on the pattern's second hex",
  );
  assertEqual(
    moteAt(overJoined, southeast)?.id,
    leg,
    "the refused constellation is left resting on the pattern's third hex",
  );

  // 2. The further filament is removed, and the motes stay exactly where they are.
  await h.debug.unlinkMotes(arm ?? -1, leg ?? -1);
  await advanceCycles(h, 1);

  const exact = await h.snapshot();
  assertEqual(
    tallyOf(exact, 0),
    1,
    "with one filament of the pattern's weight for each pattern filament and nothing further, it is accepted",
  );
  assertNull(
    moteAt(exact, hub),
    "an accepted constellation is consumed whole, so the pattern's first hex is bare",
  );
  assertNull(
    moteAt(exact, east),
    "an accepted constellation is consumed whole, so the pattern's second hex is bare",
  );
  assertNull(
    moteAt(exact, southeast),
    "an accepted constellation is consumed whole, so the pattern's third hex is bare",
  );
});
