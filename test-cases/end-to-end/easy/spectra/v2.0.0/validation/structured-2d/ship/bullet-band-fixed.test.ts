// ship/bullet-band-fixed — a bullet already in flight keeps its band when the ship
// flips.
//
// specs/bands.md, "The flip": "A bullet already in flight keeps the band it was
// fired with", and specs/ship.md says the same from the cannon's side — a shot
// carries the ship's band "at the instant it is fired, fixed for the bullet's whole
// life". This point decides what the FLIP does to a shot that is already out there,
// and nothing else: that a shot is stamped with the right band in the first place is
// `ship/bullet-carries-band`, that the flip changes the ship's band at all is
// `bands/flip-instant`, and the lockout it starts is `bands/flip-starts-lockout`.
//
// THE FLIP IS A REAL PRESS. specs/instrumentation.md carries no operation that
// flips — `setShipBand` sets the band and starts no lockout, which is a different
// thing — so the only way to put the rule under test in front of the build is the
// flip action itself, delivered at the engine's own event target on the key
// `specs/controls.md` binds `b` to. The check reads the ship's band back afterwards
// and requires it to have changed: a build whose flip did nothing has not put its
// bullet through a flip, and this point is not decided in its favour by a press that
// never happened.
//
// THE SHOT IS POSED, NOT FIRED. `addPlayerBullet` adds "one of the player's bullets
// in flight … carrying `band`" (specs/instrumentation.md), which is precisely the
// precondition the rule names — a bullet ALREADY in flight, with a band of its own —
// and posing it keeps the cannon, the cadence and the spawn point out of a point
// about neither. It is posed on the band the ship is holding, cyan, because that is
// the state a real shot leaves behind: the interesting thing is whether the flip
// drags it to magenta with the ship.
//
// THE SHOT IS HELD STILL, with `setBulletVelocity(id, 0, 0)`
// (specs/instrumentation.md), so the bullet the check reads after the flip is
// certainly the same bullet and is certainly still on the field: `specs/bands.md`
// fixes a bullet's band for its whole life however it moves, so nothing this point
// reads depends on its travel, and specs/field.md's removal at the top of the field
// is `field/player-bullet-leaves-field`'s.
//
// THE FIELD IS WATCHED FOR A FIFTH OF A SECOND AFTER THE FLIP, not read on the
// instant, so a build that repaints its bullets' bands a frame or two later is
// caught rather than sampled just before it acts.
//
// THE WORLD IS EMPTY AND QUIET. `startPosed` clears the four rosters and shuts the
// wave's entry gate, its dive gate and the ship's contact test, so no drone can
// consume the bullet before the flip lands (specs/bands.md).

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, SHIP_Y } from "../../src/constants";
import { assertEqual, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  LANE_CENTER,
  posePlayerBullet,
  startPosed,
  ticksFor,
  type Band,
  type Harness,
} from "../harness";
import { bulletOnRoster } from "./cannon";

/** The key the flip is delivered on: the first `specs/controls.md` binds to `b`. */
const FLIP_KEY = BINDINGS.b[0];

/** The band the ship holds, and the band the shot is therefore fired with. */
const FIRED_ON: Band = "cyan";

/** Where the posed shot stands: up the lane's own column, well inside the field. */
const SHOT_AT = { x: LANE_CENTER, y: SHIP_Y - 200 };

/**
 * How long the field is watched after the flip, in frames.
 *
 * A fifth of a second — twenty frames of the harness's 100 Hz clock — so a build
 * that re-reads its bullets' bands off the ship on a later frame has had every
 * chance to, and is caught rather than missed by a reading taken on the instant.
 */
const WATCH_FRAMES = ticksFor(0.2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves an in-flight bullet's band alone when the ship flips", async () => {
  startPosed(h);
  h.debug.setShipBand(FIRED_ON);
  const id = posePlayerBullet(h, SHOT_AT.x, SHOT_AT.y, FIRED_ON);
  // Held still, so the bullet read after the flip is certainly the same bullet and
  // is certainly still on the field. Its band is fixed for its whole life however it
  // moves (specs/bands.md), so nothing this point reads is changed by holding it.
  h.debug.setBulletVelocity(id, 0, 0);

  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the screen that reads the flip action");
  assertEqual(
    before.ship.band,
    FIRED_ON,
    "the band the ship holds before the flip",
  );
  assertEqual(
    bulletOnRoster(before, id, "before the flip").band,
    FIRED_ON,
    "the band the shot was posed in flight with",
  );

  await h.tap(FLIP_KEY);
  await h.advance(WATCH_FRAMES);
  // Before the assertions, so a check that fails still leaves the picture of the
  // field the flip left behind.
  captureStill(h, "kept");

  const after = h.snapshot();
  assertNotEqual(
    after.ship.band,
    FIRED_ON,
    "the ship's band a fifth of a second after the flip action was delivered, " +
      "which must have changed for this scenario to be a flip at all " +
      "(specs/bands.md)",
  );
  assertEqual(
    bulletOnRoster(after, id, `${String(WATCH_FRAMES)} frames after the flip`)
      .band,
    FIRED_ON,
    `the band of the bullet that was already in flight when the ship flipped ` +
      `to ${after.ship.band} — a bullet already in flight keeps the band it was ` +
      "fired with (specs/bands.md)",
  );
});
