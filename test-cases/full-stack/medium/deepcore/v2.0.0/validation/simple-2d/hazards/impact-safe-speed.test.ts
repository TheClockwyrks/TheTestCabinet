// hazards/impact-safe-speed — a soft landing costs nothing.
//
// `specs/hazards.md` fixes the floor of the impact rule twice over: a landing
// deals `max(0, v - IMPACT_SAFE_SPEED) * IMPACT_DAMAGE_RATE`, which is zero at
// or below 700, and "`IMPACT_SAFE_SPEED` covers a free fall of two tiles, so
// stepping off a ledge is always harmless."
//
// Both sentences are read. The first drop is a genuine free fall of two tiles
// from rest, driven by the game's own gravity, which is the claim about stepping
// off a ledge. The second poses an arrival speed near the bound and drops the
// miner the last few units onto the floor, which is the claim about the bound
// itself. Neither may cost a point of hull.
//
// The posed speed is 660 rather than 699. `specs/character.md` accelerates a
// falling miner at `GRAVITY` and the harness's frame is a hundred and twentieth
// of a second, so the speed the contact is resolved at is up to two frames of
// gravity past the posed one; 660 leaves room for that and stays inside the
// bound whichever frame a build resolves the landing on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { IMPACT_SAFE_SPEED, TILE } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  driveFall,
  openScene,
  pinDrill,
  type Harness,
} from "../harness";
import { armHull, bandRow, driveLanding, HAZARD_COL } from "./scene";

/** The tier the hull is read at: any loss at all fails, so the tier is spare. */
const HULL_TIER = 1;

/** The free fall the specification calls always harmless. */
const LEDGE_TILES = 2;

/** The arrival speed posed for the second drop, and the drop left to run. */
const POSED_SPEED = 660;
const POSED_HEIGHT = 8;

/** The column each drop runs down, and the second one beside it. */
const FALL_COL = HAZARD_COL;
const POSED_COL = HAZARD_COL + 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs no hull for a two-tile drop or a landing under the safe speed", async () => {
  openScene(h);
  pinDrill(h);
  const full = armHull(h, HULL_TIER);
  const row = bandRow(h.snapshot(), "topsoil");
  h.debug.setTile(FALL_COL, row, "rock");
  h.debug.setTile(POSED_COL, row, "rock");

  const drops = await captureReplay(h, "hop", async () => {
    const ledge = await driveFall(h, FALL_COL, row, LEDGE_TILES * TILE);
    h.debug.setHull(full);
    const posed = await driveLanding(
      h,
      POSED_COL,
      row,
      POSED_HEIGHT,
      POSED_SPEED,
    );
    return { ledge, posed };
  });

  // A free fall of two tiles lands inside the safe speed and costs nothing.
  assertEqual(drops.ledge.landed, true, "specs/character.md");
  assertLessThanOrEqual(
    drops.ledge.impactSpeed,
    IMPACT_SAFE_SPEED,
    "specs/hazards.md, a two-tile fall stays inside the safe speed",
  );
  assertEqual(
    drops.ledge.hullAfter,
    drops.ledge.hullBefore,
    "specs/hazards.md, a two-tile drop",
  );

  // And so does a landing posed just under the bound.
  assertEqual(drops.posed.landed, true, "specs/character.md");
  assertLessThanOrEqual(
    drops.posed.impactSpeed,
    IMPACT_SAFE_SPEED,
    "specs/hazards.md, the posed landing stays inside the safe speed",
  );
  assertEqual(
    drops.posed.loss,
    0,
    "specs/hazards.md, a landing under IMPACT_SAFE_SPEED",
  );
});
