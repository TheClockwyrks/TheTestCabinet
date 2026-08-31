// torpedo/homing-cone-is-forward-only — a body behind a torpedo is never acquired.
//
// `specs/weapons.md`, "The guidance": a body is a candidate when "its bearing from
// the torpedo lies within `TORPEDO_CONE` (`15` degrees) of the torpedo's current
// heading, on either side, so the cone spans `30` degrees and looks forward alone",
// and the section closes on the same rule from the other end: "a body behind it is
// never acquired". A build that searches the whole field, or that takes the nearest
// body without a bearing test at all, turns round onto the rock behind it; a build
// with the cone flies on.
//
// THE ROCK IS DIRECTLY BEHIND AND VERY CLOSE. `80` units astern, on the torpedo's
// own line, so its bearing is a full `180` degrees off the heading — the furthest
// from the cone a body can be — and it is by far the nearest body on the field, so a
// build that ranks candidates by distance before it filters them by bearing picks
// this one. Nothing in `specs/weapons.md` bounds the acquisition by range, so being
// near is what makes it a candidate for every wrong model.
//
// TWO READINGS, AND EACH CATCHES A DIFFERENT WRONG MODEL. The heading is held across
// every tick of a second — a build that turns round fails on the heading long before
// it arrives — and the rock is still standing at the end, which is what a build that
// turned round and destroyed it fails on. Neither alone is enough: a build that
// turned and missed would pass the second, and one that steers without reporting its
// heading would pass the first.
//
// THE GUIDANCE IS ON, AND THAT IS THE POINT. This is the one item in the group whose
// requirement is the cone REFUSING a body, so the faculty under test is left running
// and the field holds exactly the one rock the rule is about. The lane is the bottom
// of the field, `330` units below the star's row, so neither body approaches the
// core, and the flight ends before the torpedo reaches a seam.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, assertTrue } from "../assert";
import { DEG } from "../../src/constants";
import { angleGap, degrees } from "../geometry";
import {
  captureReplay,
  createHarness,
  poseRock,
  poseTorpedo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  HEADING_RIGHT,
  LANE_X,
  LANE_Y,
  flyTorpedo,
  rockStanding,
} from "./scene";

/** How far astern the rock is posed, in units: the nearest body on the field. */
const ASTERN = 80;

/** How long the torpedo is followed, in ticks: one second, as the manifest states. */
const FLIGHT_TICKS = ticksFor(1);

/** The ticks of flight the replay keeps once the reading has been taken. */
const TAIL_TICKS = ticksFor(0.3);

/**
 * How far the heading may turn over that second, in radians.
 *
 * One degree, compared the short way round. It is not room on the rule — a torpedo
 * with no candidate "flies straight on its current heading" — but the floor a
 * heading read back through a debug surface earns. A build that turned onto the rock
 * behind it reads a hundred and eighty times this.
 */
const HEADING_TOLERANCE = 1 * DEG;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flies on past a rock directly behind it, leaving it standing", async () => {
  startPlaying(h);
  const rock = poseRock(h, "small", LANE_X - ASTERN, LANE_Y);
  const id = poseTorpedo(h, LANE_X, LANE_Y, HEADING_RIGHT);

  const run = await captureReplay(h, "forward", async () => {
    const flown = await flyTorpedo(h, id, FLIGHT_TICKS);
    // Both readings are taken here, at the second the item names, and the clip
    // then runs on so it ends on the torpedo away down the lane rather than on
    // the frame the verdict was taken from.
    const standing = h.snapshot();
    await h.advance(TAIL_TICKS);
    return { flight: flown, standing };
  });
  const { flight } = run;

  const turned = flight.headings.reduce(
    (most, heading) => Math.max(most, angleGap(heading, HEADING_RIGHT)),
    0,
  );
  assertLessThanOrEqual(
    turned,
    HEADING_TOLERANCE,
    "the radians the torpedo's heading turned over a second with a rock " +
      `${ASTERN} units directly astern of it — the nearest body on the field ` +
      "and a full 180 degrees off its heading (specs/weapons.md: the cone looks " +
      "forward alone, and a body behind it is never acquired); " +
      `${degrees(turned).toFixed(3)} degrees`,
  );
  assertTrue(
    rockStanding(run.standing, rock),
    "the rock astern of the torpedo still standing after a second " +
      "(specs/weapons.md: a body behind a torpedo is never acquired, so nothing " +
      "turned onto it)",
  );
});
