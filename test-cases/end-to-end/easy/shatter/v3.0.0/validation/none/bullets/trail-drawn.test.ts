// bullets/trail-drawn — a moving round draws a tail along its recent path.
//
// specs/weapons.md, "The bullet trail": "Behind every moving bullet a fading tail
// traces its recent path", which "reads as one continuous streak, a smooth comet
// rather than a row of discrete dots" and "spans a fixed slice of recent travel,
// the last `TRAIL_TICKS` (`18`) ticks of the bullet's motion".
// specs/overview.md carries the same requirement as something a player reads at a
// glance: "each moving bullet leaves a continuous fading tail along its recent
// path."
//
// WHAT IS READ. Whether the build painted something at three stations laid along
// the segment from the round back toward where it stood `TRAIL_TICKS` ago — a
// tenth, a quarter and two fifths of the way along it. Painted "something" and
// not any particular colour: specs/overview.md fixes no palette and leaves the
// whole look to the build, so the only honest control is the same canvas, at the
// same simulation time, with that round taken off it. Nothing advances between
// the two readings, so the star, the ship and the HUD are painted identically in
// both and the only thing that can have moved a pixel is the round and its tail.
//
// WHY THE STATIONS STOP AT TWO FIFTHS. The same file has the tail "narrowing and
// fading to nothing at its oldest end", so its far reach is a build's own choice
// of where nothing becomes something and reading it would be reading a build's
// alpha curve rather than the requirement. Two fifths is comfortably inside the
// span while still being far enough out that a build drawing a stub at the round —
// a glow rather than a tail — fails: at `MUZZLE_SPEED` the third station is `31`
// units behind the round, ten times the round's own `BULLET_R` (`3`).
//
// THE LANE IS THE STAR'S OWN ROW, AND THAT IS WHAT KEEPS THE READING HONEST.
// specs/gravity.md pulls a bullet toward the star's centre, so a round flown along
// any other row is dragged off the line the stations are laid on. Along `y = 360`
// the pull has no vertical component at all, so the round holds the row exactly
// and the tail behind it lies on it. The stretch used, `x` from `120` to about
// `225`, is more than two hundred units clear of everything the star draws
// (specs/field.md draws nothing of it beyond `1.5 x HALO_R`, `180`) and well below
// the upper portion specs/ui.md puts the HUD in.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { MUZZLE_SPEED, STAR_Y, TICK_DT, TRAIL_TICKS } from "../constants";
import {
  captureStill,
  createHarness,
  poseBullet,
  requireBullet,
  startPlaying,
  type Harness,
} from "../harness";
import { bulletLane, laneChangeNear } from "./lane";

/** The lane the round is flown along, and where on it the flight begins. */
const LANE_Y = STAR_Y;
const START_X = 120;

/** How long the round is flown for: a full trail's worth of history, and some. */
const RUN_TICKS = TRAIL_TICKS + 6;

/** The travel `TRAIL_TICKS` covers at this speed: the span the tail is drawn over. */
const TRAIL_LENGTH = MUZZLE_SPEED * TRAIL_TICKS * TICK_DT;

/** Where along that span the tail is looked for, as fractions of it. */
const STATIONS = [0.1, 0.25, 0.4] as const;

/**
 * How far a station must move the canvas, in channel-mean brightness out of 255.
 *
 * The case's own figure, because specs/overview.md fixes no palette and leaves the
 * tail's colour to the build. `12` is a twentieth of the range, which is more than
 * the nothing that separates two renders of one unchanged pixel and far less than
 * a tail drawn to be read at a glance against a field whose background
 * specs/overview.md holds below a quarter of full.
 */
const DISTINCT_MIN = 12;

/** How many device columns either side of a station are read as part of it. */
const STATION_SPREAD = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("paints a tail along the segment behind a moving round", async () => {
  await startPlaying(h);
  const id = await poseBullet(h, START_X, LANE_Y, MUZZLE_SPEED, 0);
  await h.advance(RUN_TICKS);

  const flying = requireBullet(
    await h.snapshot(),
    id,
    "the round whose tail is read",
  );
  // The tail drawn behind a moving round.
  await captureStill(h, "trail");

  const view = h.viewport();
  const stations = STATIONS.map((along) => ({
    along,
    x: flying.x - along * TRAIL_LENGTH,
  }));
  const lane = await bulletLane(h, LANE_Y, id);

  for (const station of stations) {
    const column = Math.round(h.device(station.x, LANE_Y).x);
    const moved = laneChangeNear(
      lane.bare,
      lane.drawn,
      column,
      STATION_SPREAD + Math.ceil(view.scale),
    );
    assertGreaterThan(
      moved,
      DISTINCT_MIN,
      `the tail to move the canvas by more than ${DISTINCT_MIN} of 255 at ` +
        `(${station.x.toFixed(0)}, ${LANE_Y}), ${station.along} of the way ` +
        `from the round back along the ${TRAIL_LENGTH.toFixed(0)} units it ` +
        `covered in the last TRAIL_TICKS (${TRAIL_TICKS}) ticks, against the ` +
        `same canvas with that round removed (specs/weapons.md: a fading tail ` +
        `traces the bullet's recent path; specs/overview.md: each moving ` +
        `bullet leaves a continuous fading tail along its recent path)`,
    );
  }
});
