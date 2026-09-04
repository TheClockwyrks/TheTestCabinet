// Spectra — ship/fire-spawns-bullet: one press of fire adds exactly one bullet.
//
// THE RULE. `specs/ship.md`: "A shot is a player bullet, and it leaves the ship's
// nose", and firing is allowed whenever the cadence, the cap and the lockout all
// permit it. The review item fixes the reading: one press of the fire action adds
// EXACTLY ONE friendly bullet.
//
// EXACTLY ONE IS THE WHOLE POINT, AND IT IS WHAT SEPARATES THIS FROM
// `controls/fire-space`. That point decides that the physical key `Space` is
// wired to the `a` action at all, and is satisfied by a press that produces a
// bullet. This one decides the CANNON: a build that fires a spread of two or
// three from a single press, or that fires one on the key-down and another on the
// key-up, passes the binding point and fails here. So the assertion is an
// equality on the count and not a lower bound.
//
// WHY ONE PRESS AND NOT A HOLD. `specs/controls.md` reads `a` as a hold that
// repeats at `FIRE_INTERVAL`, so a hold would put the cadence into the reading.
// `tap` presses the key, runs exactly one frame with it down, and releases it,
// which is the smallest thing the specification calls a press — and one frame is
// far inside `FIRE_INTERVAL` (0.16 s, sixteen frames of this clock), so the
// cadence cannot produce a second shot inside it whatever the build does.
//
// THE FIELD IS EMPTY AND NOTHING BLOCKS THE SHOT. `startPosed` clears the four
// rosters, so the bullets counted afterwards can only be this press's; it leaves
// the fire cooldown and the fire lockout at zero, which are two of the three
// gates `specs/ship.md` says would otherwise block a shot, and the third — the
// `MAX_PLAYER_BULLETS` cap — cannot bind on an empty roster. It also shuts the
// wave's three gates, so no drone arrives to intercept the shot and no contact
// drops the ship into the `ready` phase. No drone is posed: a shot needs no
// target.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  playerBullets,
  startPosed,
  type Harness,
} from "../harness";

/** The key the press is delivered on: the first `specs/controls.md` binds to `a`. */
const FIRE_KEY = BINDINGS.a[0];

/** What the field holds before the press, and what one press must leave it holding. */
const BULLETS_BEFORE = 0;
const BULLETS_AFTER = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds exactly one friendly bullet for one press of fire", async () => {
  await startPosed(h);
  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "inWave",
    "the wave the key is pressed in is live",
  );
  assertEqual(
    before.phase,
    "live",
    "and the ship is flying rather than respawning",
  );
  assertEqual(before.ship.cooldown, 0, "no fire cooldown stands");
  assertEqual(before.ship.lockout, 0, "and no fire lockout stands");
  assertLength(
    playerBullets(before),
    BULLETS_BEFORE,
    "the field holds none of the player's bullets before the press",
  );

  await h.tap(FIRE_KEY);
  await captureStill(h, "fired");

  assertLength(
    playerBullets(await h.snapshot()),
    BULLETS_AFTER,
    "the player's bullets one press of fire put on the field — one, not a spread and not none (specs/ship.md)",
  );
});
