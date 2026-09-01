// Wick — weapons/projectile-ttl-expiry: a projectile is removed on the tick
// its ttl is due, whether or not it hit anything.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Projectiles and pierce"): "A projectile's `ttl` is
//     set to its `duration` when it is fired, and it is removed on the tick
//     `ttl` is due, whether or not it hit anything."
//   - `specs/weapons.md` ("Ember"): level-1 duration `2.0`, and
//     `specs/instrumentation.md` (`spawnProjectile`): a posed bolt's "`ttl` is
//     that row's duration".
//   - `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
//     `round(s × TICK_HZ)` ticks after the tick it was set on", so a ttl of
//     `2.0` posed on tick T is due on tick T + 120; ("One tick"), phase 6:
//     "Every projectile and zone that existed before this tick counts its
//     `ttl` down and is removed when it is due".
//
// WHAT IS READ. The bolt's presence after each of the 120 ticks following the
// pose: present after the 119th, gone after the 120th. Both edges are read, so
// a build a tick early fails the first and a build a tick late fails the
// second.
//
// WHY THE NIGHT IS POSED AS IT IS. One bolt on an empty field, 200 units from
// the lamplighter with zero velocity, every switch off: nothing is there to
// hit, so what removes it can only be its ttl.
//
// TOLERANCE. `FIGURE_TOLERANCE` on the posed ttl reading; none on the tick,
// which the rule fixes to a whole count.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertWithin } from "../assert";
import { EMBER_LEVELS, FIGURE_TOLERANCE, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  present,
  projectileById,
  spawnProjectileAt,
  type Harness,
} from "../harness";

/** Where the bolt is posed: along +y, clear of the lamplighter. */
const BOLT_DY = 200;

/** The bolt's ttl as posed: Ember's level-1 duration. */
const TTL = EMBER_LEVELS[0].duration;

/** The tick the ttl is due, counted from the pose. */
const DUE_TICK = ticksFor(TTL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes a ttl-2.0 bolt on the 120th tick after the pose and not the 119th", async () => {
  const posed = isolate(h);
  const bolt = spawnProjectileAt(
    h,
    "ember",
    posed.run.player.x,
    posed.run.player.y + BOLT_DY,
    0,
    0,
    0,
  );
  const placed = present(projectileById(h.snapshot(), bolt), "the posed bolt");
  assertWithin(placed.ttl, TTL, FIGURE_TOLERANCE, "the bolt's ttl as posed");

  const trace = await captureReplay(h, "expired", () => h.trace(DUE_TICK));

  assertDefined(
    projectileById(trace[DUE_TICK - 2], bolt),
    `the bolt after tick ${DUE_TICK - 1} of the pose`,
  );
  assertEqual(
    projectileById(trace[DUE_TICK - 1], bolt),
    undefined,
    `the bolt after tick ${DUE_TICK} of the pose`,
  );
});
