// Spectra — ship/bullet-travels-up: a player bullet climbs at
// PLAYER_BULLET_SPEED.
//
// THE RULE. `specs/ship.md`: a shot "travels straight up at
// `PLAYER_BULLET_SPEED` (`760`) units per second". The review item fixes the
// reading: a player bullet's centre rises `PLAYER_BULLET_SPEED` units in a second
// of game time, within 5%.
//
// THE BULLET IS PLACED RATHER THAN FIRED. `specs/instrumentation.md`'s
// `addPlayerBullet` adds "one of the player's bullets at a CENTER, climbing at
// PLAYER_BULLET_SPEED", so the build supplies its own figure and its own
// integration and this check reads the result. Firing one instead would put the
// cannon's three gates and its spawn point — four other points of this category —
// inside a reading about a bullet's speed, and a build whose cannon is broken
// would lose this point as well as those.
//
// WHY THE WINDOW IS HALF A SECOND AND NOT THE WHOLE ONE. The play field is 592
// units tall (`FIELD_TOP` 64 to `FIELD_BOTTOM` 656) and `specs/field.md` removes a
// player bullet whose centre climbs above `FIELD_TOP`, so a conformant bullet
// crosses the whole field in 0.78 s and there is no second of flight to measure
// anywhere on the stage. The rate is what the specification fixes, so the rate is
// what is asserted: the rise over half a second, divided by that half second,
// against the per-second figure. Starting eight units above `FIELD_BOTTOM`, a
// conformant bullet ends the window at 268 — still 204 units clear of the top —
// and a build climbing half again as fast is still on the field to be measured and
// reported.
//
// THE RISE IS SIGNED, ON PURPOSE. A build whose player bullets FALL reads as a
// negative rate and fails, rather than passing on the magnitude of its descent.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so there is no drone for the bullet to hit on the way up, nothing
// that could consume it, and nothing else in the roster to confuse it with. The
// bullet is placed on the lane's centre line, where no edge of the field is near
// its path.

import { afterEach, beforeEach, it } from "vitest";
import {
  FIELD_BOTTOM,
  FIELD_TOP,
  FORM_CENTER_X,
  PLAYER_BULLET_SPEED,
} from "../../src/constants";
import { assertBetween, assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  findBullet,
  lastBullet,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the bullet is placed: the centre of the lane, just inside the field's floor. */
const START_X = FORM_CENTER_X;
const START_Y = FIELD_BOTTOM - 8;

/** The band it carries. Immaterial here — no drone is posed — but one must be given. */
const BAND = "cyan" as const;

/** The window the climb is measured over, in seconds of game time and in frames. */
const MEASURE_SECONDS = 0.5;
const MEASURE_TICKS = ticksFor(MEASURE_SECONDS);

/**
 * The review item's tolerance on the rate: within 5%.
 *
 * 38 units a second. One frame of this suite's 120 Hz clock carries a conformant
 * bullet 6.33 units, so a rate computed over sixty of them is insensitive to where
 * inside a frame the build integrates, and 5% is far too narrow to admit a build
 * climbing at the enemy bullets' `ENEMY_BULLET_SPEED` (320), at half the figure, or
 * at a rate that is per-frame rather than per second.
 */
const SPEED_TOLERANCE = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("rises PLAYER_BULLET_SPEED units per second of game time", async () => {
  startPosed(h);
  h.debug.addPlayerBullet(START_X, START_Y, BAND);
  const placed = lastBullet(h.snapshot());
  assertEqual(
    placed.friendly,
    true,
    "the bullet placed is one of the player's",
  );
  assertEqual(placed.y, START_Y, "and it starts just inside the field's floor");

  await h.advance(MEASURE_TICKS);
  // Before the assertion, so a check that fails still leaves the picture of where
  // the climb carried the bullet to.
  captureStill(h, "climb");
  const climbed = findBullet(h.snapshot(), placed.id);
  if (climbed === null) {
    fail(
      `bullet ${String(placed.id)} still in flight after ` +
        `${String(MEASURE_SECONDS)}s of game time — a bullet climbing far ` +
        `faster than PLAYER_BULLET_SPEED (${String(PLAYER_BULLET_SPEED)}) ` +
        `leaves the play field above FIELD_TOP (${String(FIELD_TOP)}) first ` +
        "(specs/field.md)",
      "it had already left the bullet roster",
    );
  }

  assertBetween(
    (placed.y - climbed.y) / MEASURE_SECONDS,
    PLAYER_BULLET_SPEED * (1 - SPEED_TOLERANCE),
    PLAYER_BULLET_SPEED * (1 + SPEED_TOLERANCE),
    "the units a second the bullet's centre ROSE, PLAYER_BULLET_SPEED " +
      `(${String(PLAYER_BULLET_SPEED)}) (specs/ship.md)`,
  );
});
