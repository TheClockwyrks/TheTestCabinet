// bullets/trail-follows-the-wrap — the tail follows the round across a seam
// instead of smearing across the field.
//
// specs/weapons.md, "The bullet trail", the last bullet point: "Across a wrap it
// follows the bullet to the opposite edge rather than smearing across the field,
// so no drawn part of it is further from the bullet than `TRAIL_TICKS` of the
// bullet's travel by the shortest wrapped separation." specs/field.md fixes what
// that separation is, and that a body whose shape crosses a seam "is drawn on
// both sides at once".
//
// THE FAILURE THIS ITEM EXISTS FOR is the one a build gets for free by drawing
// its tail from the samples it recorded: the round wraps from `x = 1280` to
// `x = 0` and the tail is drawn as a straight run between the two, painting a
// streak all the way across the field. The rule quoted above is what forbids it,
// and it is stated over EVERY drawn part of the tail — so the reading is over
// every drawn part of it, not over a handful of stations.
//
// WHAT IS READ. One whole line of the canvas along the round's own row, twice:
// once as the build painted it, and once with that round removed and nothing
// advanced. Every column the two readings disagree on is something the round or
// its tail drew, and each one must lie within `TRAIL_TICKS` of the round's travel
// of the round by the shortest wrapped separation. A build that follows the round
// over the seam paints about ninety columns, all of them inside the bound; a build
// that smears paints more than a thousand, most of them hundreds of units outside
// it.
//
// TWO THRESHOLDS, ONE FOR EACH HALF. The far-side reading is a claim that
// something was drawn, and a column counts once it moved by `DISTINCT_MIN`, a
// floor any legible tail clears. The ceiling is a claim that nothing was drawn
// anywhere else on the row, and a build's empty field may twinkle or dither on
// its own between two presented frames, which is legal appearance that would
// otherwise read as a smear. So a column counts against the ceiling only past
// the lane's own measured unrest (lane.ts, `absenceBound`), or past
// `DISTINCT_MIN` where the lane is still; a smear reads far above either.
//
// AND THE OTHER HALF: SOMETHING MUST BE PAINTED PAST THE SEAM. A build that draws
// no tail at all, or that drops it on the frame the round wraps, satisfies "no
// drawn part is further than ..." by drawing nothing, so the check also requires a
// painted column in the band that lies beyond the seam and inside the near half of
// the tail's span — where specs/weapons.md has the tail still "widest and
// brightest", well short of the oldest end it fades to nothing at.
//
// THE ROUND IS FLOWN ALONG THE STAR'S OWN ROW, WESTWARD OF THE SEAM. On `y = 360`
// specs/gravity.md gives the pull no vertical component, so the round holds the
// row exactly across the wrap and the line read is the line it flew. It is posed
// at `x = 1150` and flown thirty-three ticks, which carries it about `13` units
// past the seam with a full `TRAIL_TICKS` of history behind it — so most of the
// tail is on the far side, which is precisely the arrangement the rule is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, assertTrue } from "../assert";
import {
  FIELD_W,
  MUZZLE_SPEED,
  STAR_Y,
  TICK_DT,
  TRAIL_TICKS,
} from "../constants";
import { shortestAxis, wrapX } from "../geometry";
import {
  captureStill,
  createHarness,
  poseBullet,
  requireBullet,
  startPlaying,
  type Harness,
} from "../harness";
import { absenceBound, bulletLane, changedColumns, laneX } from "./lane";

/** The lane the round is flown along, and where on it the flight begins. */
const LANE_Y = STAR_Y;
const START_X = 1150;

/**
 * How long the round is flown for, in ticks.
 *
 * Thirty-three, which at `MUZZLE_SPEED` is `143` units: enough to carry the round
 * the `130` to the seam and a little past it, and comfortably more than the
 * `TRAIL_TICKS` (`18`) of history the tail spans.
 */
const RUN_TICKS = 33;

/** The travel `TRAIL_TICKS` covers at this speed: the span the tail is drawn over. */
const TRAIL_LENGTH = MUZZLE_SPEED * TRAIL_TICKS * TICK_DT;

/**
 * How far past that span a painted column may lie, in logical units.
 *
 * `10`. The specification's bound is `TRAIL_TICKS` of travel and this is not room
 * on it: it covers the round's own `BULLET_R` disc, the round cap and width a
 * build is free to give the stroke, and a device pixel of anti-aliasing at the
 * end of it. It is an eighth of the span and a seventieth of the six hundred and
 * forty units a smeared tail is wrong by.
 */
const REACH_MARGIN = 10;

/** How far the canvas must move for a column to count as painted, out of 255. */
const DISTINCT_MIN = 12;

/**
 * The band, measured back from the round, the far side of the seam is looked in.
 *
 * From four units past the seam — far enough that the reading cannot be the
 * round's own disc reaching over it — out to half the tail's span, which
 * specs/weapons.md still has in the bright half rather than at the oldest end it
 * fades to nothing at.
 */
const PAST_SEAM_MARGIN = 4;
const BRIGHT_FRACTION = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws the tail behind the round across the seam and nowhere else", async () => {
  await startPlaying(h);
  const id = await poseBullet(h, START_X, LANE_Y, MUZZLE_SPEED, 0);
  await h.advance(RUN_TICKS);

  const flying = requireBullet(
    await h.snapshot(),
    id,
    "the round whose tail is read across the seam",
  );
  // The trail carried across the seam behind the round.
  await captureStill(h, "trail");

  assertTrue(
    flying.x < START_X,
    `the round to have crossed the right edge within ${RUN_TICKS} ticks, so ` +
      `its tail straddles the seam (specs/field.md); it stood at ` +
      `${flying.x.toFixed(1)} having been posed at ${START_X}`,
  );

  const lane = await bulletLane(h, LANE_Y, id);
  const painted = changedColumns(lane.bare, lane.drawn, DISTINCT_MIN);

  // Every column painted past the lane's own unrest, by the shortest wrapped
  // separation from the round.
  const still = absenceBound(lane, DISTINCT_MIN);
  let furthest = { at: flying.x, away: 0 };
  for (const column of changedColumns(lane.bare, lane.drawn, still)) {
    const away = Math.abs(shortestAxis(flying.x, laneX(h, column), FIELD_W));
    if (away > furthest.away) furthest = { at: laneX(h, column), away };
  }

  // And the far side of the seam, where a following tail must have painted
  // something and a tail that stopped at the edge cannot have.
  const band = {
    from: flying.x + PAST_SEAM_MARGIN,
    to: BRIGHT_FRACTION * TRAIL_LENGTH,
  };
  const beyond = painted.filter((column) => {
    const behind = wrapX(flying.x - laneX(h, column));
    return behind >= band.from && behind <= band.to;
  });

  assertTrue(
    beyond.length > 0,
    `the tail painted on the far side of the seam, between ` +
      `${band.from.toFixed(0)} and ${band.to.toFixed(0)} units back along the ` +
      `round's travel — past the ${flying.x.toFixed(1)} units of field between ` +
      `the round and the seam, and inside the bright half of the ` +
      `${TRAIL_LENGTH.toFixed(0)} units TRAIL_TICKS (${TRAIL_TICKS}) covers ` +
      `(specs/weapons.md: across a wrap it follows the bullet to the opposite ` +
      `edge); ${painted.length} columns of the row were painted at all`,
  );
  assertLessThanOrEqual(
    furthest.away,
    TRAIL_LENGTH + REACH_MARGIN,
    `every painted part of the round's tail within TRAIL_TICKS ` +
      `(${TRAIL_TICKS}) of its travel — ${TRAIL_LENGTH.toFixed(0)} units — of ` +
      `the round at x=${flying.x.toFixed(1)}, by the shortest wrapped ` +
      `separation (specs/weapons.md, specs/field.md); a column counts as ` +
      `painted past ${still.toFixed(1)} of 255, the lane's own idle unrest ` +
      `read ${lane.spread.toFixed(1)}, the furthest was at ` +
      `x=${furthest.at.toFixed(0)}, and ${painted.length} columns of the row ` +
      `were painted`,
  );
});
