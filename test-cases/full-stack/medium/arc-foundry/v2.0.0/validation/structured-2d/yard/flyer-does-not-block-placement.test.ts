// yard/flyer-does-not-block-placement — a Filament overhead refuses nothing.
//
// `specs/yard.md` fixes the condition on the Load: "No **ground** unit of the Load
// currently occupies any of the four tiles. A flying unit passes over the yard, so
// it never blocks a placement." `specs/pathing.md` says why: a flyer travels "in a
// straight line ... passing over every structure and every wall", so it is over
// the yard rather than on it.
//
// WHY IT IS ITS OWN POINT, AND WHY A PLAYER WOULD NOTICE. `occupied-tile-refused`
// decides the ground direction, where a wall must not land on a unit. This is the
// other direction of the same condition, and it is the one a build gets wrong by
// reading "no unit of the Load" and stopping there. A player cannot see the
// difference between a legal anchor and an illegal one when what decides it is
// where an unstoppable flyer happens to be at that instant, and a Filament is
// crossing the yard for most of the waves that release one.
//
// BOTH KINDS OVER ONE FOOTPRINT. The flyer is posed over the anchor and the
// placement is taken; then a ground unit is posed at the same point and the same
// placement is taken again. The second refusal is what makes the first acceptance
// mean something, because a build that accepts every placement passes half of this
// by accident.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  parkUnit,
  tileCenter,
  type Harness,
} from "../harness";

/** The footprint under test, and the tile of it the unit is posed over. */
const AT = { col: 20, row: 10 };
const OVER = { col: 21, row: 11 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands a placement under a flyer and refuses the same one under a ground unit", async () => {
  openYard(h, { wave: 1 });

  // One flyer, held over the footprint, and nothing else on the yard.
  const flyer = parkUnit(h, "filament", tileCenter(OVER.col, OVER.row));
  const posed = h.snapshot();
  assertEqual(
    posed.units.find((unit) => unit.id === flyer)?.flying,
    true,
    "the Filament to be a flying unit (specs/enemies.md)",
  );

  h.debug.placeBlocker(AT.col, AT.row);
  await h.advance(1);
  captureStill(h, "landed");
  assertEqual(
    h.snapshot().structures.length,
    1,
    `the placement anchored at (${AT.col}, ${AT.row}) to land while a flying ` +
      `unit is over tile (${OVER.col}, ${OVER.row}): a flyer passes over the ` +
      `yard, so it occupies no tile on it (specs/yard.md)`,
  );

  // The same footprint, cleared, under a ground unit instead.
  h.debug.clearStructures();
  h.debug.clearUnits();
  parkUnit(h, "mote", tileCenter(OVER.col, OVER.row));
  h.debug.placeBlocker(AT.col, AT.row);
  assertEqual(
    h.snapshot().structures.length,
    0,
    `the same placement to be refused while a GROUND unit occupies tile ` +
      `(${OVER.col}, ${OVER.row}) (specs/yard.md)`,
  );
});
