// torpedo/cone-half-angle — the cone reaches TORPEDO_CONE off the heading and no
// further.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The guidance: "A body is a
// candidate when it is a rock or the saucer and its bearing from the torpedo lies
// within `TORPEDO_CONE` (`15` degrees) of the torpedo's current heading, on either
// side". This item decides that FIGURE, and it is the only item that does: a rock
// one degree inside the edge must be taken, and a rock one degree outside it must
// be left alone.
//
// BOTH SIDES OF THE EDGE, BECAUSE EITHER ALONE PASSES A DIFFERENT WRONG BUILD. A
// check that only asked whether the `14`-degree rock was taken passes a build with
// no cone at all, which simply homes on the nearest body; a check that only asked
// whether the `16`-degree rock was spared passes a build whose cone is a degree
// wide, or one that never acquires anything. The pair pins `15` and nothing else:
// a build at `10` degrees fails the first reading, a build at `30` fails the
// second, and the two readings name which.
//
// AND BOTH SIDES OF THE HEADING, because the rule quoted above says "on either
// side". A cone measured off a SIGNED bearing rather than off its magnitude —
// a build testing `0 <= bearing - heading <= TORPEDO_CONE` instead of
// `|bearing - heading| <= TORPEDO_CONE` — reaches fifteen degrees one way and
// nothing at all the other, and a check that probed one side alone would grade it
// either wholly right or wholly wrong depending on which side it happened to
// pick. So the pair above is flown twice, once with the rocks above the
// torpedo's line and once with them below it: four scenarios in all.
//
// ONE DEGREE EITHER SIDE IS THE TIGHTEST HONEST PAIR. The bearing is set by the
// pose, exactly, and neither body is anywhere the environment can move it far
// before the question is settled: `specs/gravity.md` never pulls the torpedo, the
// acquisition is decided on the first tick, and the rock's own fall over that tick
// is under a hundredth of a unit.
//
// THE LANE IS FLAT AND THE RANGE IS SHORT ENOUGH TO STAY ON ONE SIDE OF EVERY
// SEAM. `specs/field.md` measures every bearing along the SHORTEST WRAPPED
// separation, and the field is only `720` units tall — so a rock posed more than
// `360` units above or below a torpedo is nearer the OTHER way round, and its
// bearing is the opposite one. Posing both rocks `400` units out along a nearly
// horizontal line keeps the separations at `388` across and `97` up, well inside
// half the field on both axes, so the bearing the specification means is the
// bearing this check posed. Each side of the heading gets the lane that keeps its
// rocks inside the field without wrapping: `y = 640` for the rocks posed ABOVE
// the line and `y = 80` for the rocks posed below it. Both lanes stand `280`
// units off the star's own row, so neither flight passes near the well.
//
// THE ACQUIRED ROCK IS READ AS DESTROYED rather than as turned toward, because
// destruction is unambiguous: `specs/collision.md` has a torpedo destroy the rock
// it strikes outright, and a torpedo that acquired the rock and flew at it is the
// only way a rock that started `97` units off the torpedo's line ends up gone. The
// spared rock is read BY ID, because a torpedo that destroyed it would leave two
// fragments with fresh ids in its place (`specs/rocks.md`).
//
// AND THE SPARED ROCK IS READ OFF THE HEADING AS WELL AS OFF THE ROSTER. Standing
// still is not proof of not having been acquired: a build whose cone reached `16`
// degrees but whose turn was too slow to close the `110` units of offset inside
// the span would leave the rock on the field and pass a check that only counted
// rosters. `specs/weapons.md` says what a torpedo with no candidate does — it
// "flies straight on its current heading" — so the heading is sampled at every
// tick of the pass and held to a degree of the one it was posed on. A build that
// acquired the out-of-cone rock turns the whole `16` toward it and is named here
// rather than passing on a technicality.
//
// EACH SCENARIO IS FLOWN ON ITS OWN GROUND, one after the other, each laid fresh
// by `startPlaying` — an empty field with both world gates shut, so the only rock
// in any of them is the one the check posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, assertTrue } from "../assert";
import { TORPEDO_CONE_DEG } from "../constants";
import { DEG, angleBetween } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  rockById,
  sampleEvery,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseTorpedo, standTheShipClear } from "./scenario";

/** Where the torpedo starts in every scenario, and which way it is going. */
const TORPEDO_X = 100;
const HEADING = 0;

/**
 * The lane each side of the heading is flown down, in units.
 *
 * `ABOVE` is the lane the rocks posed above the torpedo's line are flown in and
 * `BELOW` the one for the rocks posed below it, each chosen so its rock sits
 * inside the field without the pose crossing a seam. Both stand `280` units off
 * the star's row (`360`), so no flight goes near the well.
 */
const LANE = { above: 640, below: 80 } as const;

/**
 * How far off the launch centre line each rock is posed, in degrees.
 *
 * A degree inside the cone's half-angle and a degree outside it, both derived
 * from the figure `constants.ts` transcribes rather than written out, so a
 * revision to `specs/weapons.md` moves the pair this check probes with it.
 */
const INSIDE_DEG = TORPEDO_CONE_DEG - 1;
const OUTSIDE_DEG = TORPEDO_CONE_DEG + 1;

/** The two sides of the heading the rule reaches, as signs on that offset. */
const SIDES = [
  { sign: -1, name: "above" as const },
  { sign: 1, name: "below" as const },
];

/** How far out along that bearing, in units: short enough to cross no seam. */
const RANGE = 400;

/** Which of the two sides is the one the still is kept from. */
const RECORDED = "above";

/**
 * How long each scenario is flown for: `1.5` seconds.
 *
 * A torpedo that turns onto the inside rock covers the `348` units to contact in
 * about `0.83` s, so this is nearly twice the time it needs; and it is well inside
 * `TORPEDO_LIFE` (`3.5` s), so the spared rock is spared rather than merely
 * outliving a torpedo that expired. Over that span the straight-flying torpedo of
 * the second scenario covers `630` units, from `x = 100` to `x = 730`, crossing no
 * seam and coming no nearer the star's centre than `280` units — eight times the
 * `36` at which the core would absorb it.
 */
const FLIGHT_TICKS = ticksFor(1.5);

/** How long the fragments are let come apart before the still is kept. */
const AFTERMATH_TICKS = ticksFor(0.2);

/**
 * How far the heading may turn while passing the refused rock, in radians.
 *
 * One degree, compared as the shortest arc between two angles. A torpedo with no
 * candidate "flies straight on its current heading" (`specs/weapons.md`) and the
 * well never pulls it (`specs/gravity.md`), so a conforming build turns by nothing
 * at all over the pass; a build whose cone reached `16` degrees would turn the
 * whole `16` toward the rock it should have refused.
 */
const HEADING_TOLERANCE = 1 * DEG;

/** Where a rock posed `off` radians off the launch line in `lane` stands. */
function rockAt(lane: number, off: number): { x: number; y: number } {
  return {
    x: TORPEDO_X + Math.cos(HEADING + off) * RANGE,
    y: lane + Math.sin(HEADING + off) * RANGE,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it.each(SIDES)(
  `takes a rock ${String(INSIDE_DEG)} degrees off its heading $name the line ` +
    `and leaves one ${String(OUTSIDE_DEG)} degrees off`,
  async ({ sign, name }) => {
    const lane = LANE[name];

    // Inside the cone: acquired, and destroyed.
    startPlaying(h);
    standTheShipClear(h);
    const inside = rockAt(lane, sign * INSIDE_DEG * DEG);
    const insideId = poseRock(h, "large", inside.x, inside.y);
    poseTorpedo(h, TORPEDO_X, lane, HEADING);

    const taken = await h.until((s) => rockById(s, insideId) === undefined, {
      maxFrames: FLIGHT_TICKS,
    });
    // A fifth of a second of the fragments coming apart before the picture is
    // kept: on the tick of the kill the two Mediums stand on top of each other at
    // the destroyed rock's position (specs/rocks.md), so a still taken there shows
    // one circle and says nothing. The reading above is already taken.
    await h.advance(AFTERMATH_TICKS);
    // The rock just inside the cone, taken. One side is filmed, the way the
    // other swept items keep one representative frame rather than one per case.
    if (name === RECORDED) captureStill(h, "cone");

    assertTrue(
      taken.hit,
      `the rock posed ${String(INSIDE_DEG)} degrees ${name} the torpedo's ` +
        `heading — inside TORPEDO_CONE (${String(TORPEDO_CONE_DEG)} degrees), ` +
        "which reaches that far on EITHER side — to be acquired and destroyed " +
        "within 1.5 seconds of " +
        "flight (specs/weapons.md, specs/collision.md); it was still on the " +
        `field after ${String(FLIGHT_TICKS)} ticks`,
    );

    // Outside the cone: never acquired, and left standing.
    startPlaying(h);
    standTheShipClear(h);
    const outside = rockAt(lane, sign * OUTSIDE_DEG * DEG);
    const outsideId = poseRock(h, "large", outside.x, outside.y);
    poseTorpedo(h, TORPEDO_X, lane, HEADING);

    const headings = await sampleEvery(
      h,
      FLIGHT_TICKS,
      1,
      (s) => s.torpedoes?.find((torpedo) => torpedo.id === outsideId)?.heading,
    );

    assertTrue(
      rockById(h.snapshot(), outsideId) !== undefined,
      `the rock posed ${String(OUTSIDE_DEG)} degrees ${name} the torpedo's ` +
        `heading — outside TORPEDO_CONE (${String(TORPEDO_CONE_DEG)} ` +
        "degrees) — still on the field after 1.5 seconds: a body outside the " +
        "cone is never a candidate, so " +
        "nothing turns toward it (specs/weapons.md)",
    );

    const turned = headings.reduce(
      (most: number, heading) =>
        heading === undefined
          ? most
          : Math.max(most, angleBetween(heading, HEADING)),
      0,
    );
    assertLessThanOrEqual(
      turned,
      HEADING_TOLERANCE,
      "the radians the torpedo's heading turned while passing a rock " +
        `${String(OUTSIDE_DEG)} degrees ${name} it — a degree outside the ` +
        `TORPEDO_CONE (${String(TORPEDO_CONE_DEG)} degrees) half-angle ` +
        "specs/weapons.md fixes, past which a body behind it is never " +
        "acquired and the torpedo flies " +
        `straight on its current heading; ${(turned / DEG).toFixed(3)} degrees`,
    );
  },
);
