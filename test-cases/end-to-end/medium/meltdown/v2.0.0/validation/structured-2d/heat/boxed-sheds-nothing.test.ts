// Meltdown — heat/boxed-sheds-nothing: a boxed-in tower bakes.
//
// specs/heat.md states the consequence of the edge-tile rule outright: "A tower
// boxed in on all four faces sheds nothing to air at all." Every one of its
// perimeter edge-tiles faces another tower, so the air term has nothing left to
// act on, and the Sink is "the only way a boxed-in tower loses heat". That is
// what makes a firing tower in the middle of a maze climb to the trip — the bake
// the item is named for — and the measurement here is the reason for it: with all
// four faces flush against towers, the heat does not move at all.
//
// WHY THE FOUR NEIGHBOURS ARE AT THE SUBJECT'S OWN HEAT. Blocking a face is what
// this item is about; conducting through one is `heat/conduction-hot-to-cold`'s.
// Two emitters at the same heat exchange nothing (specs/heat.md), so posing the
// blanket at the subject's heat leaves the air term as the only flow that could
// move the number — and it is a gradient of zero rather than a faculty switched
// off, so the reading does not rest on `setTowerThermal` being honoured.
//
// ONE FRAME, for the same reason. Every term of a frame is computed from the
// heats the frame opened with, so over one frame the blanket's own cooling — the
// four neighbours have faces of their own on the air — cannot reach the subject.
// Over two it could, and the reading would be measuring the blanket.
//
// THE BOUND IS A FRACTION OF WHAT AN OPEN TOWER SHEDS, so a build that ignores
// the blocking and sheds through all four faces anyway fails by a factor of a
// hundred rather than by a whisker.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { BASE_K, RAD_K, TRIP_HEAT } from "../constants";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  seconds,
  startRun,
  type Harness,
} from "../harness";
import { SIDES, wallFaces } from "./faces";
import { towerOf } from "./roster";
import { BOXED_SITE } from "./sites";

/** The emitter read, and the heat the subject and its blanket are posed at. */
const TOWER = "arc";
const HEAT = 80;

/** The frame the reading is taken over, in seconds of game time. */
const DT = seconds(1);

/**
 * What the same Arc would shed over that frame with all four faces on open air:
 * `(3.6 * 4 + 1.1 * 4) * 0.80 * dt` (specs/heat.md, specs/towers.md).
 *
 * Not a requirement — it is the yardstick the bound below is a fraction of.
 */
const OPEN_FLOOR_DROP = (RAD_K * 4 + BASE_K * 4) * (HEAT / TRIP_HEAT) * DT;

/**
 * How far the boxed tower's heat may move over the frame.
 *
 * The specification requires exactly nothing, so the figure is float slack and
 * nothing else: one percent of what the same tower would have shed with its faces
 * open. A build that sheds through a blocked face fails by a hundred times this;
 * a build that resolves the frame correctly moves by zero.
 */
const DRIFT = 0.01 * OPEN_FLOOR_DROP;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("A boxed-in tower bakes", async () => {
  startRun(h);
  const site = BOXED_SITE;
  const id = poseIdleTower(h, TOWER, site.col, site.row, 0, HEAT);
  wallFaces(h, { type: TOWER, col: site.col, row: site.row }, SIDES, {
    wall: TOWER,
    heat: HEAT,
  });

  const opened = towerOf(h.snapshot(), id).heat;
  await h.advance(1);
  captureStill(h, "boxed");
  const closed = towerOf(h.snapshot(), id).heat;

  assertLessThanOrEqual(
    Math.abs(opened - closed),
    DRIFT,
    `the heat a boxed-in ${TOWER} at ${HEAT} loses to air over one frame, ` +
      `against the ${OPEN_FLOOR_DROP.toFixed(4)} it would lose with its ` +
      `faces open`,
  );
});
