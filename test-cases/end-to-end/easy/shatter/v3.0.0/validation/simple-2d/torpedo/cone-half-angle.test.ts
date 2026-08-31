// torpedo/cone-half-angle — the cone reaches 15 degrees off the heading, on either
// side, and no further.
//
// `specs/weapons.md`, "The guidance": a body is a candidate when "its bearing from
// the torpedo lies within `TORPEDO_CONE` (`15` degrees) of the torpedo's current
// heading, on either side, so the cone spans `30` degrees". This is the item that
// decides where that edge is, and it reads it from both directions: a rock `14`
// degrees off is taken, a rock `16` degrees off is not.
//
// FOUR FLIGHTS, BECAUSE THE EDGE HAS TWO SIDES AND "ON EITHER SIDE" IS PART OF THE
// RULE. A rock `14` degrees clockwise of the heading is taken, and so is one `14`
// degrees anticlockwise; a rock `16` degrees off is refused on each side too. Two
// flights would not do it: a build whose test is SIGNED rather than a magnitude —
// `0 <= off <= TORPEDO_CONE`, the commonest way to get this wrong — has a cone that
// opens to one side alone, and against a single inside rock and a single outside
// rock it passes whenever the two happen to sit on the sides it favours. Reading
// both sides of both readings leaves it nowhere to hide: it refuses one of the two
// `14`-degree rocks. A build whose cone is the right size one way and too wide the
// other fails one of the two `16`-degree readings for the same reason.
//
// EACH ROCK IS 250 UNITS AHEAD, AND THE GEOMETRY DOES THE REST. At that range a rock
// `16` degrees off the line stands `69` units across it — three times the `20` at
// which a torpedo and a Small touch (`specs/collision.md`) — so a torpedo that never
// acquires it flies past untouched, and only one that turned could reach it. A rock
// `14` degrees off stands `60` units across, so the kill cannot happen without a
// turn either: the torpedo has to come round onto it, which is exactly what
// "acquired" means.
//
// SMALLS, SO THE ROSTER READS CLEANLY. `specs/rocks.md` leaves nothing behind when a
// Small is destroyed, so "the rock is gone" and "the rock survived" are each one
// reading of the roster rather than a count of fragments.
//
// EVERY FLIGHT IS FLOWN SEPARATELY, from the same point on the same heading, with
// the field and the torpedo roster emptied between them. Two rocks on the field at
// once would put the refused one inside the cone the moment the torpedo turned onto
// the other. The column is the field's left edge, so nothing in any of the four
// comes within `400` units of the star (see `scene.ts`).

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, assertTrue } from "../assert";
import { DEG, TORPEDO_CONE } from "../../src/constants";
import { angleGap, degrees } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  poseTorpedo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  COLUMN,
  HEADING_DOWN,
  clearTorpedoes,
  flyTorpedo,
  pointAt,
  rockStanding,
} from "./scene";

/** The cone's half-angle in degrees, as `specs/weapons.md` states it. */
const CONE_DEG = degrees(TORPEDO_CONE);

/** A degree inside the cone's half-angle. */
const INSIDE_DEG = CONE_DEG - 1;

/** A degree outside it. */
const OUTSIDE_DEG = CONE_DEG + 1;

/** The two sides of the heading the rule opens to: clockwise, then anticlockwise. */
const SIDES = [
  { sign: 1, name: "clockwise" },
  { sign: -1, name: "anticlockwise" },
] as const;

/** How far ahead each rock is posed, in units. */
const RANGE = 250;

/** How long the taken rock is given to be destroyed, in ticks. */
const KILL_TICKS = ticksFor(1.2);

/** How long the refused rock is flown past, in ticks: past its whole range. */
const PASS_TICKS = ticksFor(1);

/**
 * How far the heading may turn while passing a refused rock, in radians.
 *
 * One degree, the short way round. A torpedo with no candidate "flies straight on
 * its current heading" (`specs/weapons.md`); a build whose cone reached `16` degrees
 * would turn the whole `16` toward it.
 */
const HEADING_TOLERANCE = 1 * DEG;

let h: Harness;

/** Empty the field and the roster, so each flight is posed on the same ground. */
function clearBetween(): void {
  clearTorpedoes(h);
  h.debug.clearRocks();
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes a rock 14 degrees off its heading on either side and never turns onto one 16 degrees off", async () => {
  startPlaying(h);

  for (const side of SIDES) {
    // Inside the cone: posed across the torpedo's line by more than the pair's
    // radii, so only a turn onto it could reach it.
    clearBetween();
    const offset = side.sign * INSIDE_DEG;
    const takenAt = pointAt(COLUMN, HEADING_DOWN + offset * DEG, RANGE);
    const taken = poseRock(h, "small", takenAt.x, takenAt.y);
    poseTorpedo(h, COLUMN.x, COLUMN.y, HEADING_DOWN);

    const struck = await h.until((snapshot) => !rockStanding(snapshot, taken), {
      maxFrames: KILL_TICKS,
      poll: 1,
    });
    if (side.sign === 1) {
      // The rock just inside the cone, taken.
      captureStill(h, "cone");
    }

    assertTrue(
      !rockStanding(struck.snapshot, taken),
      `the rock ${INSIDE_DEG} degrees ${side.name} of the torpedo's heading ` +
        `and ${RANGE} units ahead — ` +
        `${(RANGE * Math.sin(INSIDE_DEG * DEG)).toFixed(0)} units across its ` +
        "line, so nothing but a turn onto it could reach it — destroyed within " +
        `${KILL_TICKS} ticks (specs/weapons.md: a body inside TORPEDO_CONE ` +
        `(${CONE_DEG} degrees) of the heading, on either side, is a candidate)`,
    );
  }

  for (const side of SIDES) {
    // Outside it: the same pose, the same range, two degrees further off the line.
    clearBetween();
    const offset = side.sign * OUTSIDE_DEG;
    const missedAt = pointAt(COLUMN, HEADING_DOWN + offset * DEG, RANGE);
    const missed = poseRock(h, "small", missedAt.x, missedAt.y);
    const outside = poseTorpedo(h, COLUMN.x, COLUMN.y, HEADING_DOWN);

    const flight = await flyTorpedo(h, outside, PASS_TICKS);
    const passed = h.snapshot();

    const turned = flight.headings.reduce(
      (most, heading) => Math.max(most, angleGap(heading, HEADING_DOWN)),
      0,
    );
    assertLessThanOrEqual(
      turned,
      HEADING_TOLERANCE,
      "the radians the torpedo's heading turned while passing a rock " +
        `${OUTSIDE_DEG} degrees ${side.name} of it — a degree outside the ` +
        `TORPEDO_CONE (${CONE_DEG} degrees) half-angle specs/weapons.md fixes; ` +
        `${degrees(turned).toFixed(3)} degrees`,
    );
    assertTrue(
      rockStanding(passed, missed),
      `the rock ${OUTSIDE_DEG} degrees ${side.name} of the heading still ` +
        "standing after the torpedo flew past it (specs/weapons.md: it is " +
        "outside the cone, so it is never a candidate)",
    );
  }
});
