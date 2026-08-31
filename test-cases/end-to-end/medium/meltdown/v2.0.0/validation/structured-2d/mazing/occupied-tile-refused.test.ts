// mazing/occupied-tile-refused — a footprint overlapping a placed tower by one
// tile is refused.
//
// specs/building.md lists the six conditions a held footprint must satisfy, and
// one of them is that every tile of the footprint is open. specs/mazing.md says
// what makes a tile not open: "A tower blocks every tile of its footprint from
// the frame it lands until the frame it leaves ... A blocked tile is not open
// floor."
//
// ONE TILE, WHICH IS WHAT MAKES THIS AN EDGE CASE OF ITS OWN. A 2x2 Arc stands at
// (4, 4), covering (4, 4), (5, 4), (4, 5) and (5, 5). The candidate is another
// 2x2 Arc at (5, 5), covering (5, 5), (6, 5), (5, 6) and (6, 6) — three tiles of
// open floor and exactly one tile of the standing tower. A build that checks only
// its footprint's anchor tile, or only the tiles it thinks are "mostly" covered,
// reads this as placeable; the rule is every tile.
//
// WHY THE REFUSAL CAN ONLY BE THE OPEN-TILE CONDITION. Of the six conditions,
// this candidate satisfies five by construction: every tile is on the grid; no
// surge unit's centre is on any of them (the run is posed with an empty surge
// roster); the money is Containment Medium's own starting figure against an Arc's
// `15` (specs/towers.md); Containment fixes no build zone; and a 2x2 footprint at
// (5, 5) is nowhere near either vent-to-exhaust corridor — specs/floor.md runs
// the left corridor along rows 16..19 and the top corridor down columns 22..29 —
// so the never-seal rule of specs/mazing.md is satisfied too.
//
// The standing tower is ADDED rather than placed (specs/instrumentation.md,
// `addTower`: "It costs nothing, spends nothing, and runs no placement check"),
// so the money read back is the whole of what the run opened with, and its guns
// are off because a tower standing as a wall has no shooting to do here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";

/** The 2x2 type both towers are: the standing one and the candidate. */
const TOWER_TYPE: TowerType = "arc";

/**
 * Where the standing tower goes: a quiet anchor in the floor's north-west, clear
 * of the left corridor's rows 16..19 and the top corridor's columns 22..29
 * (specs/floor.md), so nothing here touches a route.
 */
const STANDING_COL = 4;
const STANDING_ROW = 4;

/**
 * Where the candidate is held: one tile diagonally on, so its footprint's
 * top-left tile is the standing tower's bottom-right tile and nothing else of it
 * overlaps.
 */
const CANDIDATE_COL = STANDING_COL + 1;
const CANDIDATE_ROW = STANDING_ROW + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads a footprint overlapping a tower by one tile invalid", async () => {
  startRun(h);
  poseIdleTower(h, TOWER_TYPE, STANDING_COL, STANDING_ROW);

  h.debug.setArmed(TOWER_TYPE);
  h.debug.setPreview(CANDIDATE_COL, CANDIDATE_ROW);
  await h.advance(1);
  captureStill(h, "refused");

  const posed = h.snapshot();
  const held = posed.build;
  assertEqual(
    held?.col,
    CANDIDATE_COL,
    "the preview is held where the check put it",
  );
  assertEqual(
    held?.row,
    CANDIDATE_ROW,
    "the preview is held where the check put it",
  );
  assertEqual(
    held?.valid,
    false,
    `the footprint at (${CANDIDATE_COL}, ${CANDIDATE_ROW}) covers ` +
      `(${CANDIDATE_COL}, ${CANDIDATE_ROW}), which the tower at ` +
      `(${STANDING_COL}, ${STANDING_ROW}) already blocks, and three tiles of ` +
      `open floor besides; every tile of a footprint must be open ` +
      `(specs/building.md). Whether the build read it as placeable was`,
  );

  h.debug.place();
  const after = h.snapshot();
  assertLength(
    after.towers,
    1,
    "the towers on the floor after placing on the overlapping footprint: the " +
      "one that was already there (specs/building.md)",
  );
  // The money is a CONTRAST rather than a figure. specs/building.md says an
  // invalid footprint builds nothing, blocks nothing and spends nothing, which is
  // a claim about what the press changed; holding it to Containment Medium's own
  // starting money would add a requirement this item does not carry.
  assertEqual(
    after.money,
    posed.money,
    `the money after placing on the overlapping footprint: the ${posed.money} ` +
      `it stood at before the press, nothing spent (specs/building.md)`,
  );
});
