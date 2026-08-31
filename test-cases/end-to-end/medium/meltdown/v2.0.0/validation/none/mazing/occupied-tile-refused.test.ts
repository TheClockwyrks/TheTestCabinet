// mazing/occupied-tile-refused — a footprint overlapping a placed tower by one
// tile is refused.
//
// `specs/building.md` lists the six conditions a held footprint must satisfy, and
// the second is: "Every tile of the footprint is open." `specs/mazing.md` says
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
// roster); the money is Containment Medium's `250` against an Arc's `15`;
// Containment fixes no build zone; and a 2x2 footprint at (5, 5) is nowhere near
// either vent-to-exhaust corridor, so the never-seal rule of `specs/mazing.md`
// is satisfied too. `fixtures.ts` names (4, 4) as one of the quiet anchors for
// exactly that reason.
//
// The standing tower is ADDED rather than placed (`specs/instrumentation.md`,
// `addTower`: "It costs nothing, spends nothing, and runs no placement check"),
// so the money read back is the full `250`, and its guns are off because a tower
// standing as a wall has no shooting to do here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { type TowerType } from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  startRun,
  type Harness,
} from "../harness";

/** The 2x2 type both towers are: the standing one and the candidate. */
const TOWER_TYPE: TowerType = "arc";

/** Where the standing tower goes: a quiet anchor, on no corridor. */
const STANDING_COL = FREE_SITE.col;
const STANDING_ROW = FREE_SITE.row;

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

afterEach(async () => {
  await h?.dispose();
});

it("reads a footprint overlapping a tower by one tile invalid", async () => {
  await startRun(h);
  await poseIdleTower(h, TOWER_TYPE, STANDING_COL, STANDING_ROW);

  await h.debug.setArmed(TOWER_TYPE);
  await h.debug.setPreview(CANDIDATE_COL, CANDIDATE_ROW);
  await h.advance(1);
  await captureStill(h, "refused");

  const posed = await h.snapshot();
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

  await h.debug.place();
  const after = await h.snapshot();
  assertLength(
    after.towers,
    1,
    "the towers on the floor after placing on the overlapping footprint: the " +
      "one that was already there (specs/building.md)",
  );
  // The money is a CONTRAST rather than a figure. `specs/building.md` says an
  // invalid footprint "builds nothing, blocks nothing, and spends nothing",
  // which is a claim about what the press changed; holding it to Containment
  // Medium's own starting money would add a requirement this item does not
  // carry, and `modes/*` decides that one.
  assertEqual(
    after.money,
    posed.money,
    `the money after placing on the overlapping footprint: the ` +
      `${posed.money} it stood at before the press, nothing spent ` +
      `(specs/building.md)`,
  );
});
