// presentation/surge-reads-apart-from-the-floor — a unit is not the floor.
//
// THE RULE. specs/overview.md's legibility table: "Ground units, flyers, and the
// boss read apart from one another, from the floor, and from every color a tower
// shows anywhere on its heat ramp." This point takes the middle clause and reads
// it for all six types specs/surge.md rosters, one at a time, because the floor
// is what every one of them is walking over.
//
// HOW A UNIT IS READ. A unit reports its CENTRE (specs/instrumentation.md), and
// the centre is the one part of a unit every build draws whatever shape it chose,
// so the reading is taken there: the centre pixel and four neighbours two units
// out, which is `spotColor` in presentation/read.ts and is deliberately tighter
// than the harness's tile-scale `sampleColor` — a Swarm is smaller than a tile,
// and a cluster three units either side would blur the floor into it.
//
// WHAT IS COMPARED, AND WHY IT IS NEVER A COLOUR. specs/overview.md fixes no
// palette. The reading is the unit's own centre against the floor it is standing
// over — the centre of a tile three tiles below it, which is open floor and clear
// both of the unit and of the health bar specs/hud.md draws above one.
//
// THE FLOOR IS POSED BARE. `startRun` opens on an empty floor with the run's own
// release of surge held, and each unit is posed standing still with its motion
// off, so nothing walks out of the tile it was read on and nothing arrives that
// the check did not ask for.
//
// WHAT IT DOES NOT DECIDE. Whether the six read apart from EACH OTHER is
// `ground-flyer-boss-read-apart`; whether they read apart from the heat ramp is
// `surge-off-the-heat-axis`; the health bar over a unit is
// `hud.unit-health-bars`. Nothing here asserts a size, a shape or a colour.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { SURGE_TYPES, tileCX, tileCY } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseTarget,
  startRun,
  unitOf,
  type Harness,
} from "../harness";
import { pixelAt, showRgb, spotColor } from "./read";

/**
 * How far, out of the 441 the RGB cube spans, a unit's centre must sit from the
 * floor beneath it.
 *
 * The suite's figure for two things a player tells apart at a glance, and the
 * same 50 every other point in this group draws its line at. A unit is the thing
 * a player is tracking across a floor covered in towers, so it is the last thing
 * that may read as its background.
 */
const APART_MIN = 50;

/** The row the six stand on, the pitch between them, and the first column. */
const SURGE_ROW = 8;
const SURGE_COL0 = 5;
const SURGE_PITCH = 5;

/**
 * How far below each unit the floor it is read against is sampled, in tiles.
 *
 * Three tiles is clear of the largest unit in the roster and clear of the health
 * bar drawn above one, and near enough that a build shading its floor is measured
 * against the floor it drew there.
 */
const FLOOR_REFERENCE_TILES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every surge type apart from the floor it stands on", async () => {
  startRun(h);
  const ids = SURGE_TYPES.map((type, index) =>
    poseTarget(h, type, SURGE_COL0 + index * SURGE_PITCH, SURGE_ROW),
  );
  await h.advance(1);
  captureStill(h, "surge");

  const snapshot = h.snapshot();
  SURGE_TYPES.forEach((type, index) => {
    const unit = unitOf(snapshot, ids[index]);
    const body = spotColor(h, unit.x, unit.y);
    const floor = pixelAt(
      h,
      tileCX(SURGE_COL0 + index * SURGE_PITCH),
      tileCY(SURGE_ROW + FLOOR_REFERENCE_TILES),
    );
    assertGreaterThanOrEqual(
      colorDistance(body, floor),
      APART_MIN,
      `a ${type} (${showRgb(body)}) against the floor beneath it ` +
        `(${showRgb(floor)}), out of 441 (specs/overview.md: the surge reads ` +
        `apart from the floor)`,
    );
  });
});
