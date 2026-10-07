// torpedo/turn-rate — a torpedo comes round at 160 degrees per second.
//
// specs/weapons.md, "The guidance": with a target the torpedo "turns its heading
// toward that target's current position at up to `TORPEDO_TURN` (`160` degrees per
// second), keeping its speed."
//
// WHERE THE RATE CAN BE READ AT ALL. `TORPEDO_TURN` is a CEILING — "at up to" —
// so it is only observable while the turn the target demands is larger than one
// tick of the ceiling allows. A tick of the `TICK_HZ` (`120`) clock
// specs/simulation.md fixes is worth `1.33` degrees, so a target posed `12` degrees
// off the heading demands more than a tick's worth for its first nine ticks, and
// over the six this reads the torpedo turns at exactly the ceiling if it honours it
// at all. Reading further into the turn would sample the ticks where the torpedo
// has caught up with its target and the rate is the geometry's rather than the
// build's.
//
// TWELVE DEGREES, NOT NINETY. The cone is `TORPEDO_CONE` (`15` degrees) either side
// of the heading and it is re-evaluated every tick, so no conformant build can ever
// be given a target `90` degrees off: such a body is not a candidate, the torpedo
// flies straight past it, and the reading would be `0` against every build. Twelve
// degrees is the largest demand a target can make that every build with a
// correctly-sized cone still answers, which is what makes the rate readable at all.
//
// THE TARGET IS 350 UNITS OFF, so the torpedo closes a sixteenth of the range over
// the six ticks read and the bearing it is turning toward moves by hundredths of a
// degree. The rate that comes out is the build's turn, not the pursuit's geometry.
// The shot runs along the top lane rather than down a column because the field is a
// torus: a body more than `360` units down the field is nearer the other way, so its
// bearing points backward and no conformant build acquires it (see `scene.ts`).
//
// THE WINDOW OPENS ONE TICK AFTER THE POSE, which is the same tick-order
// ambiguity `launches-from-the-nose` reasons about from the other end.
// specs/simulation.md fixes the order of work inside a tick but does not say where
// in one a torpedo just put on the field first runs its guidance, so a conformant
// build may steer on the very next tick or on the one after. Reading from the pose
// itself would charge the second build a tick it never steered through — six ticks
// of turning spread over seven, `133` degrees per second, a fifth low — and fail it
// for a choice the specification leaves open. Opening the window a tick later reads
// `160` under both conventions and costs nothing: the turn the target demands is
// still larger than one tick of the ceiling at the far end of the window either
// way.
//
// specs/gravity.md never pulls a torpedo at all, and the rock it is coming round
// onto moves by a tenth of a unit over the ticks the rate is read from.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, fail } from "../assert";
import { DEG, TICK_DT, TORPEDO_TURN_DEG } from "../constants";
import { angleDelta } from "../geometry";
import {
  captureReplay,
  createHarness,
  poseRock,
  poseTorpedo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { flyTorpedo, HEADING_RIGHT, pointAt, TOP_LANE } from "./scene";

/** How far off the heading the target is posed, in degrees: inside the cone. */
const OFF_AXIS_DEG = 12;

/** How far ahead it is posed, in units: within the field's half-height either way. */
const RANGE = 350;

/**
 * The tick the reading window opens on, counted from the pose.
 *
 * One rather than zero: which tick a posed torpedo first steers on is left open by
 * specs/simulation.md, so the window skips that tick and reads only ticks every
 * conformant build is guiding through (see above).
 */
const READ_FROM = 1;

/** How many ticks the rate is read over: all of them rate-limited (see above). */
const READ_TICKS = 6;

/** How long the flight is followed for the clip, in ticks. */
const FLIGHT_TICKS = ticksFor(1.6);

/** The ticks of aftermath the replay keeps once the target has been struck. */
const TAIL_TICKS = ticksFor(0.5);

/**
 * How far the measured rate may sit from `TORPEDO_TURN`, in degrees per second.
 *
 * Five per cent of `160`, the manifest's own allowance: `8`. A build that turns a
 * fixed fraction of the way to its target each tick reads a rate that falls as the
 * turn closes rather than the ceiling; one that turns instantly reads the whole
 * `12` degrees in one tick, `1440` degrees per second.
 */
const TOLERANCE = 0.05 * TORPEDO_TURN_DEG;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("turns 160 degrees per second onto a target 12 degrees off its heading", async () => {
  await startPlaying(h);
  const targetAt = pointAt(TOP_LANE, HEADING_RIGHT + OFF_AXIS_DEG * DEG, RANGE);
  await poseRock(h, "medium", targetAt.x, targetAt.y);
  const id = await poseTorpedo(h, TOP_LANE.x, TOP_LANE.y, HEADING_RIGHT);

  const flight = await captureReplay(h, "turn", async () => {
    const flown = await flyTorpedo(h, id, FLIGHT_TICKS);
    // The clip runs on past the reading and past the impact, so it ends on the
    // rock coming apart rather than on the frame the verdict was taken from.
    await h.advance(TAIL_TICKS);
    return flown;
  });

  if (flight.ticks < READ_FROM + READ_TICKS) {
    fail(
      `a torpedo still in flight ${READ_FROM + READ_TICKS} ticks into its turn ` +
        `onto a rock ${RANGE} units ahead (specs/weapons.md)`,
      `it left the roster after ${flight.ticks} ticks`,
    );
  }

  const swept = angleDelta(
    flight.headings[READ_FROM],
    flight.headings[READ_FROM + READ_TICKS],
  );
  const rate = swept / DEG / (READ_TICKS * TICK_DT);
  assertLessThanOrEqual(
    Math.abs(rate - TORPEDO_TURN_DEG),
    TOLERANCE,
    `the degrees per second the torpedo's heading turned over ` +
      `${READ_TICKS} ticks of coming round onto a rock ${OFF_AXIS_DEG} degrees ` +
      `off it, the window opening ${READ_FROM} tick after the pose — while the ` +
      `turn it demands is still larger than one tick of the ceiling — against ` +
      `the TORPEDO_TURN (${TORPEDO_TURN_DEG} degrees per ` +
      `second) specs/weapons.md fixes; it read ${rate.toFixed(2)}, having swept ` +
      `${(swept / DEG).toFixed(3)} degrees`,
  );
});
