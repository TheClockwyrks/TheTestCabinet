// injector/discard-off-field — a fired core whose center leaves the field is
// discarded rather than left in flight.
//
// WHERE THE THRESHOLD COMES FROM. specs/injector.md ("Flight"): "A projectile
// whose center leaves the field is discarded on that tick, changing nothing about
// the train." specs/overview.md ("The field") fixes the field at `960 x 540`
// logical units with its origin at the top-left, so "leaves the field" is the
// center passing outside `0 <= x <= 960`, `0 <= y <= 540`. specs/injector.md
// fixes the injector's center at `(420, 330)`, `PROJECTILE_SPEED` at 620 units/s
// and the aim's opening value at 270 degrees, which specs/overview.md's
// convention makes straight up the field: 330 units of field ahead of the shot,
// which at 620 units/s is 31.9 ticks of the `1 / 60` s tick
// specs/instrumentation.md fixes. Sixty ticks is therefore comfortably past the
// crossing, which is the review item's own figure.
//
// THE HALL. Empty, with nothing standing on the channel and nothing arriving:
// `poseHall` holds the inlet with `setEmission(false)` and leaves the quota
// unexhausted, so specs/progression.md's clear condition ("the moment its quota is
// exhausted and no cores remain on the channel") never fires and the flight runs
// on an EMPTY hall for its whole life. With no core anywhere, nothing can seat,
// so the only way the projectile can leave is the rule under test.
//
// WHAT IS READ. Every tick of the drive, so the discard is placed rather than
// merely noticed:
//   - the shot is still in flight at tick 20, where its center is 123 units above
//     `y = 0` and 143 units inside for a build 6% slow — so it was not discarded
//     while still on the field;
//   - no tick reports a projectile whose center sits further outside the field
//     than two ticks of its own travel — so it was discarded on the tick it left
//     rather than carried on off-screen;
//   - nothing remains at tick 60 — so it was discarded rather than left in flight.
//
// TOLERANCE. Two ticks of travel (20.7 units) on the "how far outside" reading,
// which is the case's standing +/- 2 ticks on a cadence expressed as the distance
// those ticks cover, because specs/channel.md's tick order does not fix where
// within a tick the crossing is tested. The other two readings are counts, which
// the case grades exactly, and both sit tens of ticks from the crossing, so
// neither turns on the tolerance.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  FIELD_H,
  FIELD_W,
  OPENING_AIM,
  PROJECTILE_SPEED,
  TICK_DT,
  TICK_TOL,
} from "../constants";
import {
  captureReplay,
  createHarness,
  fireAt,
  poseHall,
  type Harness,
  type VoluteSnapshot,
} from "../harness";

/** The whole drive: past the 31.9-tick crossing, and the review item's figure. */
const DRIVE_TICKS = 60;

/** The tick the shot is read as still flying, its center 123 units inside. */
const INSIDE_TICK = 20;

/** How far outside the field a center may still be reported: two ticks of travel. */
const OUTSIDE_TOL = PROJECTILE_SPEED * TICK_DT * TICK_TOL;

/** How far outside the field a projectile's center stands, `0` while it is inside. */
function outside(projectile: { x: number; y: number }): number {
  return Math.max(
    0,
    -projectile.x,
    projectile.x - FIELD_W,
    -projectile.y,
    projectile.y - FIELD_H,
  );
}

/** The furthest any projectile in a snapshot stands outside the field. */
function furthestOutside(snapshot: VoluteSnapshot): number {
  return (snapshot.projectiles ?? []).reduce(
    (worst, projectile) => Math.max(worst, outside(projectile)),
    0,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("discards a fired core once its center has left the field", async () => {
  await poseHall(h);

  const history = await captureReplay(h, "discard", async () => {
    await fireAt(h, OPENING_AIM);
    return h.stepWatching(DRIVE_TICKS);
  });

  assertEqual(history.length, DRIVE_TICKS, "the ticks the drive stepped");

  const midway = history[INSIDE_TICK - 1];
  assertEqual(midway.screen, "playing", "the screen the flight was driven on");
  assertGreaterThan(
    midway.projectiles.length,
    0,
    `projectiles at tick ${INSIDE_TICK}, with the shot still over the field`,
  );

  const strayed = history.reduce(
    (worst, snapshot) => Math.max(worst, furthestOutside(snapshot)),
    0,
  );
  assertLessThanOrEqual(
    strayed,
    OUTSIDE_TOL,
    "the units past the field's edge a projectile was still reported at",
  );

  assertEqual(
    history[history.length - 1].projectiles.length,
    0,
    `projectiles at tick ${DRIVE_TICKS}, long after the shot left the field`,
  );
});
