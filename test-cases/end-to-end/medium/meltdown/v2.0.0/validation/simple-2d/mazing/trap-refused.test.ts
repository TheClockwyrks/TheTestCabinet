// mazing/trap-refused — the placement that would trap a unit already on the floor
// is refused.
//
// specs/mazing.md: "A placement is refused when, with the candidate footprint's
// tiles blocked as well: ... any ground unit already on the floor would have no
// route from the tile its centre occupies to the opening of its assigned exhaust."
// And: "A refused placement reads invalid and builds nothing, exactly as any other
// invalid footprint does."
//
// THE FLOOR POSED. A room built out of seven 2x2 Arcs, well clear of both straight
// vent-to-exhaust corridors: a north wall over columns 34..39 of rows 24..25, a
// south wall over the same columns of rows 28..29, a west wall over columns 34..35
// of rows 26..27, and nothing on the east. Its interior is the 2x2 block at columns
// 36..37 of rows 26..27, and its doorway is the 2x2 block at columns 38..39 of the
// same two rows. A Mote stands in the interior, and the candidate footprint is one
// Arc on the doorway.
//
// WHY THE REFUSAL CAN ONLY BE THE UNIT CLAUSE, WHICH IS THE WHOLE POINT OF THE
// GEOMETRY. specs/mazing.md's never-seal rule has two clauses — the vents', and the
// units' — and a check that walled the floor in two would fire both at once and
// decide neither. This room is off both corridors, so with the doorway filled the
// left route is still `49` tiles and the top route still `35`: the vent clause is
// satisfied, and the ONLY thing the candidate breaks is the unit inside. The other
// five conditions of specs/building.md are satisfied by construction as well —
// every doorway tile is on the grid and open, no unit's centre is on one of them
// (the Mote is two columns west), the money is Containment Medium's own starting
// figure against an Arc's `15`, and Containment fixes no build zone. So a build
// that reads this footprint as valid has failed the unit clause and nothing else.
//
// THE POSE. The unit's motion is off, because a unit that walked out of the room
// while the preview was being read would take the requirement with it, and
// specs/instrumentation.md states that its route is still computed from the tile it
// stands on. Its hp is far past anything on this floor could remove, and the room's
// guns are off besides: seven Arcs around a Mote would kill it in a second, and a
// trapping check whose unit died is a check that decided nothing.
//
// The room is ADDED rather than placed (specs/instrumentation.md, `addTower`: "It
// costs nothing, spends nothing, and runs no placement check"), so building the
// scenario cannot itself be refused and the money read back is the whole of what
// the run opened with.
//
// WHAT IS NOT ASSERTED HERE. That the unit's own route out of the room is the
// `15.8995` tiles the metric gives, and no route at all with the doorway filled, is
// the geometry this check RESTS on rather than a second thing it decides: a build
// whose route metric is off by a hair would otherwise fail this item over a figure
// `mazing/towers-block-tiles` already decides. Both numbers are computed below and
// carried into the failure message instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseTarget,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";
import { ventRouteLength } from "../routes";
import { poseWall, remainingFromTile, type Footprint } from "./geometry";

/** The type the room and the candidate are both made of: the 2x2 Arc. */
const ROOM_TYPE: TowerType = "arc";

/** The interior tile the unit stands on. */
const INSIDE_COL = 36;
const INSIDE_ROW = 26;

/** The doorway: the only way out of the room, and the candidate's footprint. */
const DOOR: Footprint = { type: ROOM_TYPE, col: 38, row: 26 };

/**
 * The room: north and south walls across the interior and the doorway both, and a
 * west wall behind the unit. Nothing on the east, which is the doorway.
 */
const ROOM: readonly Footprint[] = [
  { type: ROOM_TYPE, col: 34, row: 24 },
  { type: ROOM_TYPE, col: 36, row: 24 },
  { type: ROOM_TYPE, col: 38, row: 24 },
  { type: ROOM_TYPE, col: 34, row: 26 },
  { type: ROOM_TYPE, col: 34, row: 28 },
  { type: ROOM_TYPE, col: 36, row: 28 },
  { type: ROOM_TYPE, col: 38, row: 28 },
];

/** What the specification's own metric says of the room, open and closed. */
const ROUTE_OUT = remainingFromTile(ROOM, "right", INSIDE_COL, INSIDE_ROW);
const SEALED = [...ROOM, DOOR];
const ROUTE_TRAPPED = remainingFromTile(
  SEALED,
  "right",
  INSIDE_COL,
  INSIDE_ROW,
);

/** Both vents still reach their exhausts with the doorway filled. */
const LEFT_ROUTE_TRAPPED = ventRouteLength(SEALED, "left");
const TOP_ROUTE_TRAPPED = ventRouteLength(SEALED, "top");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads a footprint that would trap a unit invalid and builds nothing on it", async () => {
  startRun(h);
  poseWall(h, ROOM);
  poseTarget(h, "mote", INSIDE_COL, INSIDE_ROW);
  await h.advance(1);

  h.debug.setArmed(ROOM_TYPE);
  h.debug.setPreview(DOOR.col, DOOR.row);
  await h.advance(1);
  captureStill(h, "refused");

  const posed = h.snapshot();
  const held = posed.build;
  assertEqual(
    held?.valid,
    false,
    `the unit in the room routes ${ROUTE_OUT.toFixed(4)} tiles out through ` +
      `the doorway at (${DOOR.col}, ${DOOR.row}); filling it leaves the unit ` +
      `with a route of ${String(ROUTE_TRAPPED)} while both vents keep theirs ` +
      `(${LEFT_ROUTE_TRAPPED.toFixed(4)} and ` +
      `${TOP_ROUTE_TRAPPED.toFixed(4)} tiles), so the unit clause of ` +
      `specs/mazing.md is the only one it breaks; whether the build read it as ` +
      `placeable was`,
  );

  h.debug.place();
  const after = h.snapshot();
  assertLength(
    after.towers,
    ROOM.length,
    "the towers on the floor after placing on the trapping footprint: the " +
      "room and nothing more (specs/building.md)",
  );
  // The money is a CONTRAST rather than a figure, for the reason `seal-refused`
  // gives: specs/building.md's claim is about what the press changed.
  assertEqual(
    after.money,
    posed.money,
    `the money after placing on the trapping footprint: the ${posed.money} it ` +
      `stood at before the press, nothing spent (specs/building.md)`,
  );
});
