// ship/fire-spawns-bullet — one press of the fire action adds exactly ONE of the
// player's bullets.
//
// specs/ship.md, "Firing": "A shot is a player bullet, and it leaves the ship's
// nose", and firing is allowed "only when all three of the following hold" — the
// cadence, the cap and the lockout. `startPosed` leaves the cadence and the lockout
// at zero and the field empty, so the cap cannot bind either: all three gates are
// open, and one press must produce one shot. Not none, which is a cannon that does
// not fire; and not two, which is a build spawning a volley where the specification
// spawns a bullet.
//
// WHAT MAKES IT ONE PRESS. The key is held for a QUARTER of `FIRE_INTERVAL`
// (`0.16` s, sixteen frames of the harness's 100 Hz clock) and then let up. Inside
// one cadence period the gate `specs/ship.md` puts on a second shot cannot have
// re-opened, so a conforming build — which fires on the first frame it reads the key
// down — has produced exactly one shot when the key comes up. The window is more
// than a single frame so that a build whose input path costs it a frame or two of
// latency still fires: it is a ceiling on that latency, and no spacing is read from
// it. `ship/fire-cadence` owns `FIRE_INTERVAL` itself and
// `controls/fire-autorepeats` owns what a longer hold does.
//
// THE KEY IS HELD RATHER THAN TAPPED, because `specs/controls.md` reads `a` as a
// HOLD: a key pressed and released inside one frame leaves the action at rest for
// the whole of that frame's update, and no conforming build would fire from it.
// WHICH keys fire is `controls/fire-space`, `controls/fire-up` and
// `controls/fire-w`, so the key here is read from the case's own bindings table
// rather than written out as a literal.
//
// THE COUNT IS AN EQUALITY, and it can be, because the field starts empty: the check
// asserts that before the press, so every friendly bullet counted afterwards is one
// this press put there. Where the shot appears is `ship/bullet-spawn-point`, how
// fast it climbs is `ship/bullet-travels-up`, and what band it carries is
// `ship/bullet-carries-band`; none of them is read here.
//
// THE WORLD IS EMPTY AND QUIET. `startPosed` clears the four rosters and shuts the
// wave's entry gate, its dive gate and the ship's contact test, so nothing else can
// put a bullet on the field or take one off it while the press is delivered.

import { afterEach, beforeEach, it } from "vitest";
import { FIRE_INTERVAL } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  holdFor,
  playerBullets,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { FIRE_KEY } from "./cannon";

/** What the field holds before the press: nothing, so the count below is an equality. */
const BULLETS_BEFORE = 0;

/** What one press must add, and the whole of what it may add. */
const SHOTS_PER_PRESS = 1;

/**
 * The frames the key is held for one press.
 *
 * A quarter of `FIRE_INTERVAL`, which is the whole of the arithmetic: strictly
 * inside one cadence period, so no conforming build can take a second shot before
 * the key is let up; and more than a single frame, so a build that reads its input a
 * frame late still takes the first.
 */
const PRESS_FRAMES = Math.floor(ticksFor(FIRE_INTERVAL) / 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds exactly one friendly bullet for one press of the fire action", async () => {
  startPosed(h);

  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the screen that reads the fire action");
  assertEqual(
    before.phase,
    "live",
    "the ship is flying rather than respawning",
  );
  assertEqual(
    before.ship.cooldown,
    0,
    "the fire cooldown the ship was posed with",
  );
  assertEqual(
    before.ship.lockout,
    0,
    "the fire lockout the ship was posed with",
  );
  assertLength(
    playerBullets(before),
    BULLETS_BEFORE,
    "the player's bullets on the field before the press",
  );

  await holdFor(h, FIRE_KEY, PRESS_FRAMES);
  // Before the assertion, so a check that fails still leaves the picture of what
  // the press put on the field.
  captureStill(h, "fired");

  assertLength(
    playerBullets(h.snapshot()),
    SHOTS_PER_PRESS,
    `the player's bullets on the field after one press of the fire action, ` +
      `held ${String(PRESS_FRAMES)} frames — under one FIRE_INTERVAL ` +
      `(${String(FIRE_INTERVAL)}s) — onto an empty field with the cadence, the ` +
      "cap and the lockout all clear (specs/ship.md)",
  );
});
