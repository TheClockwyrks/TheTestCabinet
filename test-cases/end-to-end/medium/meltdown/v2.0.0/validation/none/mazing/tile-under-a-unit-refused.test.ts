// mazing/tile-under-a-unit-refused — a footprint containing the tile a unit
// stands on is refused.
//
// `specs/building.md` lists the six conditions a held footprint must satisfy, and
// the third is: "No tile of the footprint is the tile a surge unit's centre
// occupies." `specs/floor.md` fixes which tile that is, through the inverse map
// `c = floor((x - FLOOR_X0) / TILE)`, `r = floor((y - FLOOR_Y0) / TILE)`.
//
// THE SCENARIO. One Mote stands on tile (10, 10), a quiet anchor on neither
// vent-to-exhaust corridor (`fixtures.ts`). A 2x2 Arc is then held with its
// footprint's top-left on that very tile, so the footprint covers (10, 10),
// (11, 10), (10, 11) and (11, 11) — the unit's tile and three tiles of open
// floor.
//
// WHY THE REFUSAL CAN ONLY BE THE UNIT CONDITION. Of the six conditions, this
// candidate satisfies five by construction: every tile is on the grid; every tile
// is open, because the floor holds no tower at all; the money is Containment
// Medium's `250` against an Arc's `15`; Containment fixes no build zone; and a
// 2x2 footprint at (10, 10) is clear of both corridors, so with it blocked both
// vents keep their routes and the never-seal rule of `specs/mazing.md` is
// satisfied. So a build that reads this footprint as placeable has failed the
// unit condition and nothing else.
//
// THE POSE. The unit's motion is off, and that is load-bearing rather than
// incidental: a walker would leave the tile the check is about while the preview
// was being read, and the reading would then be measuring the latency of the
// reading. `specs/instrumentation.md` states that a unit with its motion off
// holds its position and keeps having its route computed from the tile it stands
// on, so it is a unit standing on a tile in every sense the condition means.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { colAt, rowAt, type TowerType } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseTarget,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";

/** The 2x2 type the candidate footprint is: the Arc. */
const TOWER_TYPE: TowerType = "arc";

/** The tile the unit stands on, and the candidate footprint's top-left tile. */
const STAND = freeSite(4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("reads a footprint over the tile a unit stands on invalid", async () => {
  await startRun(h);
  const unit = await poseTarget(h, "mote", STAND.col, STAND.row);

  await h.debug.setArmed(TOWER_TYPE);
  await h.debug.setPreview(STAND.col, STAND.row);
  await h.advance(1);
  await captureStill(h, "refused");

  // THE FRAME ABOVE IS THE PICTURE, NOT THE READING. A frame hands the build a
  // frame of input, and nothing in `specs/instrumentation.md` makes a pose
  // survive one: `specs/building.md` writes "The preview follows the pointer"
  // as an invariant over the pointer's own `(x, y)`, so a build that
  // re-establishes it every frame is reading that sentence rather than breaking
  // it. So the pose is taken again for the READING, and brought into agreement
  // through the surface's own refresher — `reconcile()` "brings every value the
  // snapshot reports into agreement with the game as it now stands, without
  // advancing anything", and `build.valid` is one of the derived fields it
  // answers for (`specs/instrumentation.md`).
  await h.debug.setArmed(TOWER_TYPE);
  await h.debug.setPreview(STAND.col, STAND.row);
  await h.debug.reconcile();

  const posed = await h.snapshot();
  const standing = requireUnit(posed, unit, "the unit under the footprint");
  const tile = { col: colAt(standing.x), row: rowAt(standing.y) };

  assertEqual(
    posed.build?.valid,
    false,
    `the footprint at (${STAND.col}, ${STAND.row}) covers the tile the unit's ` +
      `centre occupies, (${tile.col}, ${tile.row}) by specs/floor.md's own ` +
      `inverse map, and three tiles of open floor besides; no tile of a ` +
      `footprint may be a unit's tile (specs/building.md). Whether the build ` +
      `read it as placeable was`,
  );

  await h.debug.place();
  const after = await h.snapshot();
  assertLength(
    after.towers,
    0,
    "the towers on the floor after placing over the unit: none " +
      "(specs/building.md)",
  );
  // The money is a CONTRAST rather than a figure. `specs/building.md` says an
  // invalid footprint "builds nothing, blocks nothing, and spends nothing",
  // which is a claim about what the press changed; holding it to Containment
  // Medium's own starting money would add a requirement this item does not
  // carry, and `modes/*` decides that one.
  assertEqual(
    after.money,
    posed.money,
    `the money after placing over the unit: the ${posed.money} it stood at ` +
      `before the press, nothing spent (specs/building.md)`,
  );
});
