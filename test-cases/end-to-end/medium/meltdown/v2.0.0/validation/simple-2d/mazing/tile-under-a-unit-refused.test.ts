// mazing/tile-under-a-unit-refused — a footprint containing the tile a unit stands
// on is refused.
//
// specs/building.md lists the six conditions a held footprint must satisfy, and one
// of them is that no tile of the footprint is the tile a surge unit's centre
// occupies. specs/floor.md fixes which tile that is, through the inverse map
// `c = floor((x - FLOOR_X0) / TILE)`, `r = floor((y - FLOOR_Y0) / TILE)`.
//
// THE SCENARIO. One Drift hangs over tile (10, 10), a quiet anchor clear of the
// left corridor's rows 16..19 and the top corridor's columns 22..29
// (specs/floor.md). A 2x2 Arc is then held with its footprint's top-left on that
// very tile, so the footprint covers (10, 10), (11, 10), (10, 11) and (11, 11) —
// the unit's tile and three tiles of open floor.
//
// WHY THE UNIT IS A FLYER, WHICH IS WHAT MAKES THIS ITS OWN ITEM. The condition
// says "a surge unit", and the never-seal rule of specs/mazing.md says "any GROUND
// unit already on the floor". Those two are not separable over a WALKER: blocking
// the tile a walker's centre occupies leaves that walker with no route from that
// tile whatever else the floor looks like, so the never-seal rule refuses the
// footprint as well and a build honouring only that rule would pass an item meant
// to decide this one. A flyer takes no route and the never-seal rule passes over
// it, so the third condition of specs/building.md is the ONLY thing left that
// refuses this footprint. `mazing/trap-refused` is the item that decides the
// never-seal clause, over a ground unit, and it is a different item.
//
// WHY THE REFUSAL CAN ONLY BE THAT CONDITION. Of the six, this candidate satisfies
// five by construction: every tile is on the grid; every tile is open, because the
// floor holds no tower at all; the money is Containment Medium's own starting
// figure against an Arc's `15` (specs/towers.md); Containment fixes no build zone;
// and a 2x2 footprint at (10, 10) is clear of both corridors, so with it blocked
// both vents keep their routes and no ground unit is on the floor at all. So a
// build that reads this footprint as placeable has failed the unit condition and
// nothing else.
//
// THE POSE. The unit's motion is off, and that is load-bearing rather than
// incidental: a flyer under its own power would leave the tile the check is about
// while the preview was being read, and the reading would then be measuring the
// latency of the reading. specs/instrumentation.md states that a unit with its
// motion off holds its position, so it is a unit standing on a tile in every sense
// the condition means.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { tileAt } from "../geometry";
import {
  captureStill,
  createHarness,
  poseTarget,
  startRun,
  unitOf,
  type Harness,
  type TowerType,
} from "../harness";

/** The 2x2 type the candidate footprint is: the Arc. */
const TOWER_TYPE: TowerType = "arc";

/** The tile the flyer hangs over, and the candidate footprint's top-left tile. */
const STAND_COL = 10;
const STAND_ROW = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads a footprint over the tile a unit stands on invalid", async () => {
  startRun(h);
  const unit = poseTarget(h, "drift", STAND_COL, STAND_ROW);

  h.debug.setArmed(TOWER_TYPE);
  h.debug.setPreview(STAND_COL, STAND_ROW);
  await h.advance(1);
  captureStill(h, "refused");

  const posed = h.snapshot();
  const standing = unitOf(posed, unit);
  const tile = tileAt(standing.x, standing.y);

  assertEqual(
    posed.build?.valid,
    false,
    `the footprint at (${STAND_COL}, ${STAND_ROW}) covers the tile the unit's ` +
      `centre occupies, (${tile.col}, ${tile.row}) by specs/floor.md's own ` +
      `inverse map, and three tiles of open floor besides; no tile of a ` +
      `footprint may be a unit's tile (specs/building.md). Whether the build ` +
      `read it as placeable was`,
  );

  h.debug.place();
  const after = h.snapshot();
  assertLength(
    after.towers,
    0,
    "the towers on the floor after placing over the unit: none " +
      "(specs/building.md)",
  );
  // The money is a CONTRAST rather than a figure. specs/building.md says an
  // invalid footprint builds nothing, blocks nothing and spends nothing, which is
  // a claim about what the press changed; holding it to Containment Medium's own
  // starting money would add a requirement this item does not carry.
  assertEqual(
    after.money,
    posed.money,
    `the money after placing over the unit: the ${posed.money} it stood at ` +
      `before the press, nothing spent (specs/building.md)`,
  );
});
