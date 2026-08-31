// rocks/recycle-resets-speed — the star hands the rock a fresh drift speed.
//
// `specs/rocks.md`, Star recycling: the rock re-enters "at a fresh base drift speed
// drawn from its size's range". This item decides that the speed is DRAWN AFRESH
// rather than carried across, which is what keeps repeated recycling from
// accelerating a rock without bound: a Large's base drift range is
// `ROCK_SPEED_MIN.large` to `ROCK_SPEED_MAX.large` (`60` to `110`), and that is
// where the rock must come back however fast it went in.
//
// THE ROCK GOES IN AT THE REVIEW ITEM'S FIGURE, `400` units per second, which is
// nearly four times the top of the window it must come back inside — and by the
// time the well has finished with it over the fall it is moving faster still. So a
// build that carried the incoming velocity across reads hundreds of units above the
// window, and a build that re-placed the rock at rest reads far below it. Neither
// can be mistaken for a fresh draw, and the reading does not depend on which number
// the draw happened to give.
//
// THE FIELD HOLDS ONE ROCK AND NOTHING ELSE. `startPlaying` empties every roster
// and shuts both world gates, and the rock is dropped from straight above the star's
// centre so the well's pull is exactly along its fall. The recycle is found as a
// move of more than `200` units inside one tick, which nothing drifting can produce,
// so a build with no recycling in it fails rather than being read as one.
//
// THE TOLERANCE IS ONE TICK OF THE WELL. The reading is taken on the tick the rock
// re-entered, by which time the well may already have acted on it once. A recycled
// rock stands on an edge, and the nearest point of any edge to the star is `360`
// units out (`specs/field.md`), where `specs/gravity.md` pulls at `MU / 360^2` =
// `34.7` units per second squared — under a third of a unit in a tick. One unit
// either side of the window covers that with room and admits nothing a build could
// pass on by mistake.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_SPEED_MAX, ROCK_SPEED_MIN } from "../../src/constants";
import { assertBetween } from "../assert";
import { speedOf } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { dropOntoTheStar, slingIntoTheStar, theOneRock } from "./scene";

/** The speed the rock is slung into the star at: the review item's figure. */
const SLING_SPEED = 400;

/** How far outside the base-speed window the reading may sit, in units per second. */
const WELL_SLACK = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns a Large slung at 400 units per second at a Large's own drift speed", async () => {
  startPlaying(h);
  dropOntoTheStar(h, "large", SLING_SPEED);

  const recycle = await slingIntoTheStar(h);
  captureStill(h, "recycle");

  const returned = theOneRock(recycle.at, "the recycled rock");

  assertBetween(
    speedOf(returned),
    ROCK_SPEED_MIN.large - WELL_SLACK,
    ROCK_SPEED_MAX.large + WELL_SLACK,
    "the base drift speed a recycled Large re-enters at (specs/rocks.md)",
  );
});
