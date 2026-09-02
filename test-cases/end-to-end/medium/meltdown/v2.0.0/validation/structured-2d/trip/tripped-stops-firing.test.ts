// Meltdown — trip/tripped-stops-firing: a tripped tower is offline.
//
// specs/heat.md, The trip: a tripped emitter "fires nothing and acquires no
// target for the whole of its cooldown", and specs/combat.md says the same from
// the other side — "A tripped emitter reports `firing` false for the whole of its
// cooldown", and on a frame in which it is tripped its fire accumulator "neither
// grows nor falls". So the tower is not merely quiet on the frame it tripped: for
// five whole seconds a unit standing in its range takes nothing from it.
//
// THE MARK IS THE POINT OF THE CHECK. A tripped tower with an empty floor in
// front of it fires nothing whatever the build does, so the reading would pass a
// build that never took the tower offline at all. What is posed here is a tower
// that WOULD be firing — a mark parked four tiles out, well inside the Arc's
// `6.0`-tile range, with its motion off so it cannot walk away and hp far past a
// cooldown's worth of shots so it cannot die — and the reading is that nothing
// reaches it.
//
// THE TRIP IS POSED, NOT MANUFACTURED. `poseTrippedTower` sets the tripped flag,
// the cooldown and the heat directly (specs/instrumentation.md), so this item
// decides what a tripped tower DOES and fails for that alone; whether a build
// reaches the trip in the first place is `trips-at-100`'s single requirement.
//
// THE WINDOW STOPS SHORT OF THE COOLDOWN'S END ON PURPOSE. specs/heat.md brings
// the tower back online at `TRIP_TIME`, and a build is free to resolve that
// return anywhere inside the frame that crosses it, so the last two frames of the
// cooldown belong to `returns-cold` rather than here. Everything before them is
// unambiguously inside the cooldown.

import { afterEach, beforeEach, it } from "vitest";
import { TRIP_HEAT, TRIP_TIME } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseTrippedTower,
  seconds,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import { FREE_SITE, poseMarkEast, towerOf, unitOf } from "./bench";

/** The emitter taken offline, and the heat the trip left it at. */
const TOWER = "arc";
const TRIPPED_AT = TRIP_HEAT;

/**
 * Frames of the cooldown the window covers.
 *
 * `TRIP_TIME` is `5.0` seconds, which is 600 frames of the 120 Hz clock; the
 * window stops two frames short so that every frame it reads is inside the
 * cooldown whichever side of the crossing a build resolves the return on. Two
 * frames is `0.017` s, a third of one percent of the cooldown.
 */
const RETURN_SLACK_FRAMES = 2;
const WINDOW_FRAMES = ticksFor(TRIP_TIME) - RETURN_SLACK_FRAMES;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("A tripped tower is offline", async () => {
  startRun(h);
  const id = poseTrippedTower(
    h,
    TOWER,
    FREE_SITE.col,
    FREE_SITE.row,
    TRIPPED_AT,
    TRIP_TIME,
  );
  const mark = poseMarkEast(h, TOWER, FREE_SITE);
  const opened = unitOf(h.snapshot(), mark).hp;

  for (let frame = 0; frame < WINDOW_FRAMES; frame += 1) {
    await h.advance(1);
    assertEqual(
      towerOf(h.snapshot(), id).firing,
      false,
      `whether a tripped ${TOWER} reports firing ` +
        `${seconds(frame + 1).toFixed(3)}s into its ${TRIP_TIME}s cooldown`,
    );
  }
  captureStill(h, "offline");

  const tower = towerOf(h.snapshot(), id);
  assertEqual(
    unitOf(h.snapshot(), mark).hp,
    opened,
    `the hp of a mark in range of a tripped ${TOWER} after ` +
      `${seconds(WINDOW_FRAMES).toFixed(3)}s`,
  );
  assertEqual(
    tower.damageDealt,
    0,
    `the damage a tripped ${TOWER} dealt over its cooldown`,
  );
  assertEqual(
    tower.kills,
    0,
    `the kills a tripped ${TOWER} took over its cooldown`,
  );
});
