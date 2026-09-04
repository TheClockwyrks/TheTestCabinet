// mazing/seal-refused — the placement that would seal the floor is refused.
//
// `specs/mazing.md`: "A placement is refused when, with the candidate
// footprint's tiles blocked as well: either vent's opening would have no route to
// the opening of its opposite exhaust ... A refused placement reads invalid and
// builds nothing, exactly as any other invalid footprint does."
// `specs/building.md` adds what building nothing means: "Placing on an invalid
// footprint builds nothing, blocks nothing, and spends nothing."
//
// THE FLOOR POSED. A solid two-column wall of 2x2 Arcs down columns 30..31, on
// every pair of rows from 0 to 35 EXCEPT rows 16..17 — seventeen towers, one gap.
// With the gap open the left vent still reaches the right exhaust at its full
// `49` tiles; with the gap filled there is no route at all, and the wall is two
// columns thick so there is no diagonal to squeeze through either. The candidate
// footprint is one more Arc, on exactly that gap.
//
// WHY THE REFUSAL CAN ONLY BE THE SEAL RULE. `specs/building.md` lists six
// conditions a held footprint must satisfy, and the candidate satisfies five of
// them by construction: every tile is on the grid (columns 30..31, rows 16..17);
// every tile is open (the wall skipped exactly those rows); no surge unit's
// centre is on any of them (the run is posed with an empty surge roster); the
// money is Containment Medium's `250` against an Arc's `15`; and Containment
// fixes no build zone. The sixth is the never-seal rule, so a build that reads
// this footprint as valid has failed that rule and nothing else. That is what
// makes this a check on one requirement rather than on the placement check at
// large — `building/*` decides the other five.
//
// The wall is ADDED rather than placed (`specs/instrumentation.md`, `addTower`:
// "It costs nothing, spends nothing, and runs no placement check"), so building
// the scenario cannot itself be refused, and the money left over is the full
// `250` the check reads back.
//
// The guns are off across the wall: `specs/mazing.md` walls the floor with a
// tower "whatever kind of tower it is", and nothing here fires at anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { ROWS, TOWER_DEFS, type TowerType } from "../constants";
import { blockedSet, routeLength, seals } from "../routes";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseWall, stackedWall, type Footprint } from "./geometry";

/** The type the wall and the candidate are both made of: the 2x2 Arc. */
const WALL_TYPE: TowerType = "arc";

/** The column band the wall runs down: two tiles thick, so no diagonal squeeze. */
const WALL_COL = 30;

/** The rows the gap is left on: the candidate footprint's own two rows. */
const GAP_ROW = 16;

/** Every row an Arc of the wall is anchored on: the gap's row excepted. */
const WALL_ROWS = Array.from(
  { length: ROWS / TOWER_DEFS[WALL_TYPE].size },
  (_, index) => index * TOWER_DEFS[WALL_TYPE].size,
).filter((row) => row !== GAP_ROW);

/** The wall, and the one footprint that would close it. */
const WALL = stackedWall(WALL_TYPE, WALL_COL, WALL_ROWS);
const CANDIDATE: Footprint = {
  type: WALL_TYPE,
  col: WALL_COL,
  row: GAP_ROW,
};

/** What the specification's own predicate says of the floor and the candidate. */
const OPEN_ROUTE = routeLength(blockedSet(WALL), "left");
const CANDIDATE_SEALS = seals(blockedSet([...WALL, CANDIDATE]));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("reads a sealing footprint invalid and builds nothing on it", async () => {
  await startRun(h);
  await poseWall(h, WALL);

  await h.debug.setArmed(WALL_TYPE);
  await h.debug.setPreview(CANDIDATE.col, CANDIDATE.row);
  await h.advance(1);
  await captureStill(h, "refused");

  const posed = await h.snapshot();
  const held = posed.build;
  assertEqual(
    held?.col,
    CANDIDATE.col,
    "the preview is held on the gap the check posed",
  );
  assertEqual(
    held?.row,
    CANDIDATE.row,
    "the preview is held on the gap the check posed",
  );
  assertEqual(
    held?.valid,
    false,
    `the last gap in the wall down columns ${WALL_COL}..` +
      `${WALL_COL + TOWER_DEFS[WALL_TYPE].size - 1} is the whole of the left ` +
      `vent's ${OPEN_ROUTE}-tile route, and filling it seals the floor ` +
      `(specs/mazing.md says so of this very footprint: ` +
      `${String(CANDIDATE_SEALS)}); whether the build read it as placeable was`,
  );

  await h.debug.place();
  const after = await h.snapshot();
  assertLength(
    after.towers,
    WALL.length,
    "the towers on the floor after placing on the sealing footprint: the wall " +
      "and nothing more (specs/building.md)",
  );
  // The money is a CONTRAST rather than a figure. `specs/building.md` says an
  // invalid footprint "builds nothing, blocks nothing, and spends nothing",
  // which is a claim about what the press changed; holding it to Containment
  // Medium's own starting money would add a requirement this item does not
  // carry, and `modes/*` decides that one.
  assertEqual(
    after.money,
    posed.money,
    `the money after placing on the sealing footprint: the ${posed.money} it ` +
      `stood at before the press, nothing spent (specs/building.md)`,
  );
});
