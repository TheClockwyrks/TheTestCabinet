// pathing/combine-wall-neutral — a combine is wall-neutral, so the maze length is
// the same figure either side of it.
//
// `specs/scrap-press.md` states the rule twice over: every footprint a combine
// consumes hardens into a blocker rather than being freed, and the result lands
// on the footprint the combine was initiated from. Put together, the yard's walls
// are untouched by a fold.
//
// WHY IT MATTERS ENOUGH TO BE ITS OWN POINT. A plain combine is available during
// a live wave (`specs/campaign.md`), and `specs/pathing.md` promises that a wave
// walks the maze it started with. A build that frees the consumed footprints
// opens a hole in the maze under the Load's feet, at the one moment the route is
// not supposed to move — so the rule that keeps a combine from doing it is a
// pathing requirement rather than a press one.

import { afterEach, beforeEach, it } from "vitest";

import { assertCloseTo, assertEqual, assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  standComponent,
  structureAt,
  type Harness,
} from "../harness";

/** The pair that is folded: two of a type at a tier, standing in the maze. */
const INITIATOR = { col: 20, row: 4 };
const PARTNER = { col: 24, row: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the maze length exactly where it was across a fold", async () => {
  openYard(h);

  // Two standing components of the same type at the same quality: a quality fold
  // of standing structures alone, so nothing here starts a wave.
  const initiator = standComponent(
    h,
    "capacitor",
    1,
    INITIATOR.col,
    INITIATOR.row,
  );
  standComponent(h, "capacitor", 1, PARTNER.col, PARTNER.row);
  const before = h.snapshot();

  const after = await captureReplay(h, "neutral", async () => {
    await h.advance(6);
    h.debug.combine(initiator);
    await h.advance(6);
    return h.snapshot();
  });

  assertCloseTo(
    after.mazeLength,
    before.mazeLength,
    6,
    `the maze length across a combine, against the ${before.mazeLength} the ` +
      `same yard read before it`,
  );

  // Neither footprint was freed: the result stands on the initiating one and the
  // consumed one still carries a structure.
  assertLength(
    after.structures,
    before.structures.length,
    "the structures on the yard across a fold of two into one, the consumed " +
      "footprint having hardened rather than been freed",
  );
  assertEqual(
    structureAt(after, INITIATOR.col, INITIATOR.row) === undefined,
    false,
    `a structure still standing on the initiating footprint ` +
      `(${INITIATOR.col}, ${INITIATOR.row}), where the fold's result lands`,
  );
  assertEqual(
    structureAt(after, PARTNER.col, PARTNER.row) === undefined,
    false,
    `a structure still standing on the consumed footprint ` +
      `(${PARTNER.col}, ${PARTNER.row}), which hardens rather than reopening`,
  );
});
