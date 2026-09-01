// Wick — evolutions/chandelier-revolves: the set revolves at
// `LANTERN_ANGULAR_SPEED` about the lamplighter, wherever the lamplighter is.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Chandelier"): "From the next tick they revolve at
//     `LANTERN_ANGULAR_SPEED` (`180`) degrees per second clockwise, the circle
//     they ride centered on the player's center every tick".
//   - `specs/state.md` (`ZoneState`): "each tick places it at that angle,
//     advanced by `LANTERN_ANGULAR_SPEED` (`180`) `× TICK_DT` degrees", 3
//     degrees a tick, so after `k` ticks a lantern is `3 × k` degrees on from
//     where it started, and after 30 ticks 90 degrees on.
//   - `specs/weapons.md` ("The nearest enemy"): "positive angles turning toward
//     `+y`, which is clockwise on screen".
//   - `specs/evolutions.md` ("Chandelier"): the fixed row's orbit is `120`, and
//     `orbit` is "recomputed on every tick", so the distance from the
//     lamplighter's center is the orbit on every tick.
//   - `specs/instrumentation.md` (`setPlayerPosition`): "the aura and lanterns
//     follow on the next tick"; (The driver switches): the lanterns revolve
//     while `effectMotion` is on.
//   - `specs/world.md` ("The lamplighter"): `MOVE_SPEED` (`180`) units per
//     second, so 3 units a tick is the distance a walking lamplighter covers.
//
// WHAT IS READ. The lowest-id lantern of the set after each of 30 ticks, with
// the lamplighter posed 3 units further along `+x` before every one of them:
// its angle about the lamplighter's center of that tick reads its starting
// angle plus `3 × k` degrees, and its distance from that center reads 120. On
// tick 30 the angle is 90 degrees on from where it started, and every tick
// between is read too, so a build turning the other way, at another rate, or
// about a fixed point cannot land on the same reading by coincidence.
//
// WHY THE NIGHT IS POSED AS IT IS. Chandelier alone with nothing on the field,
// every driver switch off but `effectMotion`, the one faculty the revolution
// needs. The lamplighter is moved through `setPlayerPosition` rather than a
// held key, so the reading is the placement rule alone and never the movement
// rule, which the lamplighter's own points decide. One lantern is followed by
// id, so which of the four is read is never in doubt.
//
// TOLERANCE. `MOTION_TOLERANCE` on the angle and the distance: an angle
// integrated tick by tick and a distance formed from a cosine and a sine of it,
// read back as doubles.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin, fail } from "../assert";
import {
  CHANDELIER_STATS,
  LANTERN_ANGULAR_SPEED,
  MOTION_TOLERANCE,
  MOVE_SPEED,
  TICK_DT,
  ticksFor,
} from "../constants";
import {
  angleAbout,
  captureReplay,
  createHarness,
  distance,
  enable,
  normalizeDeg,
  zoneById,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { poseEvolved } from "./evolved";
import { chandelierLanterns, lowestId } from "./chandelier";

/** How long the set is watched: half a second, a quarter turn. */
const WATCH_TICKS = ticksFor(0.5);

/** The degrees one tick turns a lantern: 180 × 1/60 = 3. */
const DEGREES_PER_TICK = LANTERN_ANGULAR_SPEED * TICK_DT;

/** How far the lamplighter is posed along +x before each tick: 180 × 1/60 = 3. */
const STEP = MOVE_SPEED * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("turns a lantern 3 degrees a tick, 90 degrees over 30, about a moving lamplighter", async () => {
  const { player } = poseEvolved(h, "chandelier");
  enable(h, "effectMotion");

  const placed = await h.tick(1);
  const set = chandelierLanterns(placed);
  assertEqual(
    set.length,
    CHANDELIER_STATS.amount,
    "Chandelier lanterns after the placing tick",
  );
  const watched = lowestId(set, "the set after the placing tick");
  const startAngle = angleAbout(placed.run.player, watched);

  const seen = await captureReplay(h, "revolving", async () => {
    const snapshots: WickSnapshot[] = [];
    for (let tick = 1; tick <= WATCH_TICKS; tick += 1) {
      h.debug.setPlayerPosition(player.x + STEP * tick, player.y);
      snapshots.push(await h.tick(1));
    }
    return snapshots;
  });

  seen.forEach((snapshot, index) => {
    const tick = index + 1;
    const lantern = zoneById(snapshot, watched.id);
    if (lantern === undefined) fail(`the lantern after tick ${tick}`, "gone");
    const expected = normalizeDeg(startAngle + DEGREES_PER_TICK * tick);
    const read = angleAbout(snapshot.run.player, lantern);
    const offset = Math.abs(((read - expected + 540) % 360) - 180);
    assertWithin(
      offset,
      0,
      MOTION_TOLERANCE,
      `the lantern's angle after tick ${tick}, expected ${expected} degrees and read ${read}`,
    );
    assertWithin(
      distance(snapshot.run.player, lantern),
      CHANDELIER_STATS.orbit,
      MOTION_TOLERANCE,
      `the lantern's distance from the lamplighter after tick ${tick}`,
    );
  });
});
