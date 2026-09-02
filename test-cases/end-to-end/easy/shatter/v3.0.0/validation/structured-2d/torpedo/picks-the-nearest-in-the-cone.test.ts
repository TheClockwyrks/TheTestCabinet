// torpedo/picks-the-nearest-in-the-cone — of two candidates, the nearer wins.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The guidance: "Among the candidates
// the torpedo takes the NEAREST by shortest wrapped distance." That the cone
// decides WHICH bodies are candidates is `torpedo/cone-half-angle`'s and
// `torpedo/homing-cone-is-forward-only`'s business; this item decides the choice
// among them, and it is the only item that poses two at once.
//
// THE TWO ROCKS LIE ON OPPOSITE SIDES OF THE CENTRE LINE, both squarely inside the
// cone — one `9` degrees below the heading at `260` units, the other `9` degrees
// above it at `560`. That is what makes the two answers different NUMBERS rather
// than different degrees of the same number: a build that takes the nearer turns
// toward `+9` degrees, and a build that takes the first in roster order, the
// furthest, or the one nearest the centre line turns toward `-9`. Eighteen degrees
// separate them, and the reading is taken after fifteen ticks — at `TORPEDO_TURN`,
// twenty degrees of turning, so a build that made either choice has arrived at it.
//
// WHAT THIS ITEM DOES NOT SEPARATE is the wrap convention the rule names. Both
// rocks stand within `553` units across and `88` up of the torpedo — inside half
// the field on both axes — so the shortest wrapped separation and the plain one
// coincide and the bearing the specification means is the bearing this check
// posed. A scenario posed across a seam would be deciding `specs/field.md`'s
// measurement rather than this rule, and would fail a build whose choice is right
// for two bodies a reviewer can see.
//
// THE READING IS THE BEARING FROM WHERE THE TORPEDO ACTUALLY IS at the moment it
// is read, not from where it was posed: the torpedo has moved `52` units by then,
// and a pursuit that is tracking correctly holds its heading ON the bearing rather
// than on the angle it started closing.
//
// NEITHER ROCK IS REACHED, and neither moves far. The nearer needs about `59`
// ticks to be struck and this check runs fifteen; the further of the two is `173`
// units from the star's centre, where the well moves it about a unit over the
// span. `startPlaying` leaves nothing else on the field.

import { afterEach, beforeEach, it } from "vitest";
import { DEG } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import { angleBetween, bearing } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  requireTorpedo,
  startPlaying,
  type Harness,
} from "../harness";
import { poseTorpedo, standTheShipClear } from "./scenario";

/** Where the torpedo starts, and which way it is going. */
const TORPEDO_X = 100;
const TORPEDO_Y = 620;
const HEADING = 0;

/** The nearer candidate: 9 degrees BELOW the heading, 260 units out. */
const NEAR_OFF = 9 * DEG;
const NEAR_RANGE = 260;
/** The further one: 9 degrees ABOVE it, 560 units out. */
const FAR_OFF = -9 * DEG;
const FAR_RANGE = 560;

/** How long the torpedo is given to come round: 20 degrees of turning. */
const TURN_TICKS = 15;

/**
 * How far the heading may sit from the bearing to the nearer rock, in radians.
 *
 * `3` degrees. A torpedo that has finished turning onto a target holds its
 * heading on the bearing to it, and the only thing that keeps it off is the
 * `1.33` degrees one tick of `TORPEDO_TURN` is worth, so this is a tick and a bit
 * of slack. The wrong choice this has to separate is the bearing to the FURTHER
 * rock, `18` degrees away — six times outside it.
 */
const AIM_TOLERANCE = 3 * DEG;

/** Where a rock posed `off` radians off the launch line at `range` stands. */
function rockAt(off: number, range: number): { x: number; y: number } {
  return {
    x: TORPEDO_X + Math.cos(HEADING + off) * range,
    y: TORPEDO_Y + Math.sin(HEADING + off) * range,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns a torpedo onto the nearer of two rocks inside its cone", async () => {
  startPlaying(h);
  standTheShipClear(h);
  const near = rockAt(NEAR_OFF, NEAR_RANGE);
  const far = rockAt(FAR_OFF, FAR_RANGE);
  const nearId = poseRock(h, "large", near.x, near.y);
  const farId = poseRock(h, "large", far.x, far.y);
  const torpedoId = poseTorpedo(h, TORPEDO_X, TORPEDO_Y, HEADING);

  await h.advance(TURN_TICKS);
  const after = h.snapshot();
  // The torpedo turning onto the nearer of two rocks.
  captureStill(h, "acquired");

  const torpedo = requireTorpedo(
    after,
    torpedoId,
    "the torpedo still in flight fifteen ticks in, with both rocks still " +
      "further off than it can have reached (specs/weapons.md)",
  );
  const nearRock = requireRock(
    after,
    nearId,
    "the nearer of the two candidates",
  );
  const farRock = requireRock(
    after,
    farId,
    "the further of the two candidates",
  );

  const toNear = bearing(torpedo, nearRock);
  const toFar = bearing(torpedo, farRock);
  const off = angleBetween(torpedo.heading, toNear);

  assertLessThanOrEqual(
    off,
    AIM_TOLERANCE,
    "the torpedo's heading to be on the bearing to the NEARER of the two " +
      `rocks in its cone, within ${(AIM_TOLERANCE / DEG).toFixed(0)} degrees ` +
      "— among the candidates the torpedo takes the nearest by shortest " +
      `wrapped distance (specs/weapons.md); it sat ${(off / DEG).toFixed(2)} ` +
      `degrees off that bearing and ` +
      `${(angleBetween(torpedo.heading, toFar) / DEG).toFixed(2)} degrees off ` +
      `the bearing to the further one, which stands ${FAR_RANGE - NEAR_RANGE} ` +
      "units beyond it",
  );
});
